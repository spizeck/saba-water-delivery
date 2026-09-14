import "server-only";

import {
  type DocumentReference,
  FieldPath,
  FieldValue,
} from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger } from "@/lib/logging";

import {
  createDriverOffer,
  getDeclinedRequestIdsForDriver,
  getPendingOfferForDriver,
  recordOfferResponse,
} from "./driverOffers";
import { sabaCalendarDateKey, startOfSabaDay } from "@/lib/utils/datetime";
import { appConfig } from "./config";
import { PRIORITY_RANK, priorityRankFor } from "./priority";
import type { DispatchPriority, DriverOffer, WaterRequest } from "./types";
import {
  isOfferableToDriver,
  selectNextDispatchCandidate,
} from "./dispatchSelection";
import { reconcileActiveRequestByUserId } from "./driverRegistry";
import {
  claimWaterRequest,
  expirePreferredDriverHolds,
  getClaimedRequestsForDriver,
  getWaterRequestById,
  toWaterRequest,
} from "./waterRequests";

/**
 * Dispatch orchestration layer implementing the one-request-at-a-time
 * driver offer workflow (see PRODUCT.md "Open Request Queue" and
 * TECHNICAL.md "Dispatch Offers").
 *
 * This module decides WHICH request (if any) to offer a driver next, and
 * records the accept/decline decision. It deliberately does not weaken
 * the existing atomic claim guarantee in `claimWaterRequest()` — an offer
 * is just a UI/bookkeeping construct, not a reservation. Two drivers can
 * in principle be offered the same request; whichever accepts first wins
 * the transaction, and the other's accept attempt fails cleanly.
 */

const REQUESTS_COLLECTION = "waterRequests";

const logger = getLogger("domain.dispatch");

// ---------------------------------------------------------------------------
// Canonical candidate scan (issue #66)
// ---------------------------------------------------------------------------

/**
 * Documents read per Firestore page while scanning dispatch candidates.
 * Matches the previous `limit(100)` window, but is no longer a cap on
 * selection correctness — it only controls read batching.
 */
const CANDIDATE_PAGE_SIZE = 100;

/**
 * Total documents a single `getNextOfferForDriver` call may read across
 * ALL candidate streams (holds + available + the legacy catch-all).
 * Bounds a selection attempt — far beyond Saba's realistic queue size —
 * while still making a pathological queue terminate instead of scanning
 * unboundedly. Reaching this bound is a safety stop, not a completeness
 * result; it is logged as `dispatch.candidate_scan_exhausted` so an
 * inconclusive selection is observable in operational telemetry.
 */
const MAX_CANDIDATE_DOCS = 1000;

interface CandidateScanBudget {
  docsScanned: number;
  /** Set when a stream still had unread candidates when the budget ran
   * out — meaning the selection result is not provably complete. */
  exhausted: boolean;
}

/**
 * Lazily yields a query's documents in page-size batches using
 * `startAfter(document)` cursors — deterministic, no offset pagination,
 * and no duplicates or skips within the stream's ordering. Stops when the
 * stream ends or the shared document budget is spent.
 */
async function* pageCandidates(
  query: FirebaseFirestore.Query,
  budget: CandidateScanBudget,
): AsyncGenerator<FirebaseFirestore.QueryDocumentSnapshot> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    if (budget.docsScanned >= MAX_CANDIDATE_DOCS) {
      // One extra 1-doc probe distinguishes "budget spent with more
      // candidates unread" from "stream happened to end at the bound".
      let probe = query.limit(1);
      if (cursor) probe = probe.startAfter(cursor);
      if (!(await probe.get()).empty) budget.exhausted = true;
      return;
    }
    let page = query.limit(CANDIDATE_PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    budget.docsScanned += snap.size;
    if (snap.empty) return;
    for (const doc of snap.docs) yield doc;
    if (snap.size < CANDIDATE_PAGE_SIZE) return;
    cursor = snap.docs[snap.size - 1];
  }
}

/**
 * Yields candidate requests in EXACT canonical dispatch order — the same
 * order `dispatchQueueCompare` produces (priority bucket →
 * `dispatchOverrideRank` ascending with unranked last → original
 * `requestedAt` ascending) — over the complete matching queue, not a
 * fixed-size pre-filter window (issue #66).
 *
 * The canonical order cannot be expressed as a single Firestore query:
 * "unranked last" is not an index ordering (Firestore `!= null` orders
 * ranked docs by their rank, but unranked/null docs cannot be ordered
 * after them), and `orderBy`/`!= null` silently drop documents where the
 * field is missing entirely. So the order is decomposed into streams that
 * concatenate exactly to it:
 *
 *   for each `dispatchPriority` bucket (best first):
 *     R) ranked docs only — `dispatchOverrideRank != null` ordered by
 *        (dispatchOverrideRank, requestedAt, documentId)
 *     L) the whole bucket ordered by (requestedAt, documentId) — NO
 *        dispatchOverrideRank filter, so legacy documents that predate
 *        the field (never backfilled) are still reached; docs already
 *        yielded by R are skipped via the `seen` set.
 *
 *   then a catch-all stream ordered by documentId with no ordering-field
 *   filters at all — the only query shape that can see a document missing
 *   `dispatchPriority` or `requestedAt`. Such documents should not exist
 *   (both fields are written on every create/priority-change path), but
 *   if one does it is surfaced last rather than permanently hidden —
 *   consistent with `toWaterRequest`'s normal-priority/newest-age
 *   defaults for missing fields.
 *
 * Buckets key on `dispatchPriority`, NOT the denormalized `priorityRank`,
 * because the canonical comparator derives the bucket via
 * `priorityRankFor(request.dispatchPriority)`. Keying on stored
 * `priorityRank` would misplace documents where the denormalized field is
 * missing or stale (they would sink to the catch-all behind genuinely
 * lower-priority work). `priorityRank` remains write-only bookkeeping for
 * other readers and is no longer consulted here.
 *
 * Reads stay lazy: streams are only paged as far as the caller consumes,
 * so the common case costs 1–2 small queries. There is no global queue
 * snapshot — a request that changes class mid-scan can be skipped or seen
 * twice, which is safe because selection is advisory and
 * `claimWaterRequest()` remains the atomic authority.
 */
async function* iterateCandidatesInDispatchOrder(options: {
  status: "available" | "preferred_driver_hold";
  preferredDriverId?: string;
  budget: CandidateScanBudget;
}): AsyncGenerator<WaterRequest> {
  const db = getAdminDb();
  const { status, preferredDriverId, budget } = options;
  const seen = new Set<string>();

  const scoped = (): FirebaseFirestore.Query => {
    let q: FirebaseFirestore.Query = db
      .collection(REQUESTS_COLLECTION)
      .where("status", "==", status);
    if (preferredDriverId) {
      q = q.where("preferredDriverId", "==", preferredDriverId);
    }
    return q;
  };

  // Priority buckets in canonical order — keyed on `dispatchPriority`,
  // the field `dispatchQueueCompare` actually reads via `priorityRankFor`.
  // Derived from the rank table so a future priority level is picked up
  // automatically.
  const priorities = [...Object.keys(PRIORITY_RANK)] as DispatchPriority[];
  priorities.sort((a, b) => priorityRankFor(a) - priorityRankFor(b));

  for (const priority of priorities) {
    const ranked = scoped()
      .where("dispatchPriority", "==", priority)
      .where("dispatchOverrideRank", "!=", null)
      .orderBy("dispatchOverrideRank")
      .orderBy("requestedAt")
      .orderBy(FieldPath.documentId());
    for await (const doc of pageCandidates(ranked, budget)) {
      seen.add(doc.id);
      yield toWaterRequest(doc.id, doc.data());
    }

    const byAge = scoped()
      .where("dispatchPriority", "==", priority)
      .orderBy("requestedAt")
      .orderBy(FieldPath.documentId());
    for await (const doc of pageCandidates(byAge, budget)) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      yield toWaterRequest(doc.id, doc.data());
    }
  }

  const catchAll = scoped().orderBy(FieldPath.documentId());
  for await (const doc of pageCandidates(catchAll, budget)) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    yield toWaterRequest(doc.id, doc.data());
  }
}

/**
 * Returns the first candidate in canonical dispatch order that satisfies
 * `eligible`, scanning lazily and stopping at the first match. Returns
 * null when the queue is provably exhausted OR when the shared scan
 * budget was spent — the latter sets `budget.exhausted` so the caller can
 * surface an inconclusive result.
 */
async function findFirstCandidate(
  scope: {
    status: "available" | "preferred_driver_hold";
    preferredDriverId?: string;
  },
  eligible: (request: WaterRequest) => boolean,
  budget: CandidateScanBudget,
): Promise<WaterRequest | null> {
  for await (const request of iterateCandidatesInDispatchOrder({
    ...scope,
    budget,
  })) {
    if (eligible(request)) return request;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selecting the next offer
// ---------------------------------------------------------------------------

export interface NextOffer {
  offer: DriverOffer;
  request: WaterRequest;
}

/**
 * Returns the single request currently offered to this driver, creating a
 * new offer if none is pending. Returns null if there is nothing eligible
 * to offer right now.
 *
 * Selection priority:
 *   1. A preferred-driver hold addressed to this driver (not yet expired).
 *      Ties (more than one hold addressed to the same driver) are broken
 *      by the canonical queue order.
 *   2. Otherwise, the highest-ranked "available" request this driver has
 *      not already declined, in canonical dispatch order — priority
 *      bucket, then `dispatchOverrideRank` (unranked last), then oldest
 *      `requestedAt` (see PRODUCT.md "Priority-Based Dispatch" /
 *      TECHNICAL.md "Dispatch Offer Selection").
 *
 * Both candidate pools are produced by `iterateCandidatesInDispatchOrder`,
 * which paginates the complete matching queue in canonical order — a
 * fixed-size pre-filter window can no longer hide a better-ranked or
 * merely-later eligible request (issue #66).
 *
 * Callers must ensure the driver is online, eligible, and not in a
 * decline cooldown before calling this — those are prerequisites for
 * receiving offers at all, not part of request selection itself.
 */
export async function getNextOfferForDriver(
  driverId: string,
): Promise<NextOffer | null> {
  const now = new Date();

  // Reconcile stale activeRequestId before checking claimed deliveries.
  // If the lock points to a deleted/completed/reassigned request, clear
  // it so the driver is not permanently blocked from receiving offers.
  await reconcileActiveRequestByUserId(driverId);

  // Load the driver's current claimed delivery (if any). This is used both to
  // enforce the one-active-delivery rule and to avoid issuing a duplicate
  // offer while a delivery is in progress.
  const activeDeliveries = await getClaimedRequestsForDriver(driverId);
  const activeDelivery = activeDeliveries[0] ?? null;

  // Request IDs this driver declined within the recent dispatch window.
  // Used both to filter fresh candidates and to invalidate a stale
  // pending offer for a request the driver has already declined.
  const declinedIds = await getDeclinedRequestIdsForDriver(driverId);

  // Reuse an existing pending offer so reloading the page doesn't
  // manufacture a new offer while one is awaiting a response.
  let pendingPair: { offer: DriverOffer; request: WaterRequest } | null = null;
  const pending = await getPendingOfferForDriver(driverId);
  if (pending) {
    const request = await getWaterRequestById(pending.requestId);
    if (
      request &&
      isOfferableToDriver(request, driverId, now) &&
      !declinedIds.has(request.id)
    ) {
      pendingPair = { offer: pending, request };
    } else {
      // The request was claimed/cancelled/reassigned out from under this
      // offer before the driver responded, or the driver already declined
      // this request — expire it and select fresh.
      await recordOfferResponse(pending.id, "expired");
    }
  }

  // Opportunistic maintenance: expire any preferred-driver holds that have
  // passed their window, regardless of which driver triggered this read.
  // This keeps the general queue populated without a separate scheduled
  // job (mirrors the previous browsable-queue behavior).
  await expirePreferredDriverHolds(now);

  // Candidate scans share one page budget so a single selection attempt
  // is bounded across every stream it consults. When a valid pending
  // offer exists it wins by policy — no queue reads are needed at all.
  const budget: CandidateScanBudget = { docsScanned: 0, exhausted: false };

  let holdCandidate: WaterRequest | null = null;
  let availableCandidate: WaterRequest | null = null;
  if (!pendingPair) {
    // Priority 1: the canonically-first preferred-driver hold addressed
    // to this driver that is still offerable (not expired).
    holdCandidate = await findFirstCandidate(
      { status: "preferred_driver_hold", preferredDriverId: driverId },
      (request) => isOfferableToDriver(request, driverId, now),
      budget,
    );

    // Priority 2: the canonically-first available request this driver has
    // not recently declined — see PRODUCT.md "Priority-Based Dispatch".
    if (!holdCandidate) {
      availableCandidate = await findFirstCandidate(
        { status: "available" },
        (request) =>
          isOfferableToDriver(request, driverId, now) &&
          !declinedIds.has(request.id),
        budget,
      );
    }
  }

  const candidate = selectNextDispatchCandidate({
    activeDelivery,
    pendingOffer: pendingPair,
    // Each array carries at most the first eligible candidate found by the
    // canonical paginated scan — the selector's "first eligible wins"
    // iteration is unchanged, so precedence (pending → hold → available)
    // and decline semantics stay identical.
    holds: holdCandidate ? [holdCandidate] : [],
    available: availableCandidate ? [availableCandidate] : [],
    declinedRequestIds: declinedIds,
    driverId,
    now,
  });

  if (!candidate) {
    if (budget.exhausted) {
      // The scan hit its safety bound with unread candidates remaining:
      // "no offer" here is inconclusive — eligible work may exist beyond
      // the bound. Surface it operationally; never silently. Counts only —
      // no request IDs or customer data.
      logger.warn("dispatch.candidate_scan_exhausted", {
        driverId,
        docsScanned: budget.docsScanned,
        docLimit: MAX_CANDIDATE_DOCS,
      });
    }
    return null;
  }

  // When the selected candidate is the request already offered to this
  // driver, return the existing pending offer instead of minting a
  // duplicate offer document on every page load.
  if (pendingPair && pendingPair.request.id === candidate.id) {
    return pendingPair;
  }

  const offer = await createDriverOffer(driverId, candidate.id);
  return { offer, request: candidate };
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

export interface AcceptDriverOfferInput {
  offerId: string;
  driverId: string;
}

/**
 * Accepts an offer. Delegates the actual claim to `claimWaterRequest()`,
 * which is the sole source of atomic-claim correctness — this function
 * only adds offer bookkeeping around it. If the underlying claim fails
 * (e.g. another driver claimed it first), the offer is marked "expired"
 * rather than "declined" so it is not mistaken for a driver's choice, and
 * the original error is rethrown for the caller to present.
 */
export async function acceptDriverOffer(
  input: AcceptDriverOfferInput,
): Promise<WaterRequest> {
  const { offerId, driverId } = input;
  const db = getAdminDb();
  const offerSnap = await db.collection("driverOffers").doc(offerId).get();

  if (!offerSnap.exists) throw new Error("OFFER_NOT_FOUND");
  const offerData = offerSnap.data()!;
  if (offerData.driverId !== driverId) throw new Error("OFFER_NOT_FOUND");
  if (offerData.response !== null) throw new Error("OFFER_ALREADY_RESOLVED");

  try {
    const request = await claimWaterRequest({
      requestId: offerData.requestId,
      driverId,
    });
    await recordOfferResponse(offerId, "accepted");
    return request;
  } catch (err) {
    await recordOfferResponse(offerId, "expired");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Decline
// ---------------------------------------------------------------------------

export interface DeclineDriverOfferInput {
  offerId: string;
  driverId: string;
}

export interface DeclineDriverOfferResult {
  declined: true;
  availabilityStatus: "available" | "cooldown" | "daily_limit";
  cooldownUntil: string | null;
  declineCount: number;
  maxDeclinesPerDay: number;
}

/**
 * Declines an offer. Does not claim the request — it remains available
 * (at its original `requestedAt` priority) for another eligible driver.
 *
 * If the declined offer was a preferred-driver hold addressed to this
 * driver, the hold ends immediately and the request opens to the general
 * queue rather than waiting for the hold window to expire naturally (see
 * PRODUCT.md "Preferred Driver").
 *
 * After recording the decline, checks whether the driver has now reached
 * the configured daily decline limit and, if so, starts a cooldown.
 */
export async function declineDriverOffer(
  input: DeclineDriverOfferInput,
): Promise<DeclineDriverOfferResult> {
  const { offerId, driverId } = input;
  const db = getAdminDb();
  const offerRef = db.collection("driverOffers").doc(offerId);

  const now = new Date();
  const endOfToday = startOfSabaDay(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );

  const result = await db.runTransaction<DeclineDriverOfferResult>(
    async (txn) => {
      // ---- All reads first ----
      const offerSnap = await txn.get(offerRef);
      if (!offerSnap.exists) throw new Error("OFFER_NOT_FOUND");
      const offerData = offerSnap.data()!;
      if (offerData.driverId !== driverId) throw new Error("OFFER_NOT_FOUND");
      if (offerData.response !== null)
        throw new Error("OFFER_ALREADY_RESOLVED");

      const requestId = offerData.requestId as string;
      const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
      const requestSnap = await txn.get(requestRef);

      // Any other pending offers of this same request to this driver are
      // duplicates; expire them alongside the decline so the request is not
      // immediately re-offered from a stale pending record. Equality-only
      // query — no composite index required.
      const duplicatePendingSnap = await txn.get(
        db
          .collection("driverOffers")
          .where("driverId", "==", driverId)
          .where("requestId", "==", requestId)
          .where("response", "==", null),
      );

      const settingsRef = db.collection("config").doc("dispatchSettings");
      const settingsSnap = await txn.get(settingsRef);
      const settingsData = settingsSnap.data() ?? {};
      const maxDeclinesPerDay =
        typeof settingsData.maxDeclinesPerDay === "number" &&
        settingsData.maxDeclinesPerDay >= 1
          ? settingsData.maxDeclinesPerDay
          : appConfig.defaultMaxDeclinesPerDay;
      const declineCooldownHours =
        typeof settingsData.declineCooldownHours === "number" &&
        settingsData.declineCooldownHours > 0
          ? settingsData.declineCooldownHours
          : appConfig.defaultDeclineCooldownHours;

      // Count declines already recorded today (this offer is not yet declined).
      const lookback = new Date(now.getTime() - 26 * 60 * 60 * 1000);
      const declinesSnap = await txn.get(
        db
          .collection("driverOffers")
          .where("driverId", "==", driverId)
          .where("response", "==", "declined")
          .where("respondedAt", ">=", lookback),
      );
      const todayKey = sabaCalendarDateKey(now);
      const declinesBeforeThis = declinesSnap.docs.filter((doc) => {
        const respondedAt = doc.data().respondedAt?.toDate?.();
        return (
          respondedAt instanceof Date &&
          sabaCalendarDateKey(respondedAt) === todayKey
        );
      }).length;

      const willEnterCooldown = declinesBeforeThis + 1 >= maxDeclinesPerDay;

      // If cooldown is needed, locate the driver registry by linked user.
      let registryRef = null as DocumentReference | null;
      if (willEnterCooldown) {
        const registrySnap = await txn.get(
          db
            .collection("driverRegistry")
            .where("linkedUserId", "==", driverId)
            .limit(1),
        );
        if (!registrySnap.empty) {
          registryRef = registrySnap.docs[0].ref;
        }
      }

      // ---- All writes after reads ----
      const nowField = FieldValue.serverTimestamp();

      // 1. Record the offer as declined; expire duplicate pending offers of
      // the same request so only one decline is counted.
      txn.update(offerRef, {
        response: "declined",
        respondedAt: nowField,
      });
      for (const doc of duplicatePendingSnap.docs) {
        if (doc.id === offerId) continue;
        txn.update(doc.ref, {
          response: "expired",
          respondedAt: nowField,
        });
      }

      // 2. Release an active preferred-driver hold to the general queue.
      if (requestSnap.exists) {
        const requestData = requestSnap.data()!;
        if (
          requestData.status === "preferred_driver_hold" &&
          requestData.preferredDriverId === driverId
        ) {
          const requestUpdate: Record<string, unknown> = {
            availableAt: nowField,
            updatedAt: nowField,
          };
          // Preserve status if it is already being updated to available. Use a
          // single update for both status and timestamps to keep writes minimal.
          requestUpdate.status = "available";
          txn.update(requestRef, requestUpdate);

          const eventRef = requestRef.collection("events").doc();
          txn.set(eventRef, {
            type: "preferred_driver_declined",
            actorId: driverId,
            actorRole: "driver",
            createdAt: nowField,
            metadata: { preferredDriverId: driverId },
          });
        }
      }

      // 3. Start cooldown if threshold reached.
      const declineCount = declinesBeforeThis + 1;
      if (willEnterCooldown) {
        if (!registryRef) {
          throw new Error("DRIVER_NOT_LINKED_FOR_COOLDOWN");
        }

        const cooldownUntil = new Date(
          now.getTime() + declineCooldownHours * 60 * 60 * 1000,
        );

        txn.update(registryRef, {
          cooldownUntil,
          updatedAt: nowField,
          updatedBy: driverId,
        });

        const cooldownEventRef = registryRef.collection("events").doc();
        txn.set(cooldownEventRef, {
          type: "driver_cooldown_started",
          actorId: driverId,
          actorRole: "driver",
          createdAt: nowField,
          metadata: {
            declineCount,
            maxDeclinesPerDay,
            cooldownUntil: cooldownUntil.toISOString(),
          },
        });

        const availabilityStatus =
          cooldownUntil.getTime() >= endOfToday.getTime()
            ? "daily_limit"
            : "cooldown";

        return {
          declined: true,
          availabilityStatus,
          cooldownUntil: cooldownUntil.toISOString(),
          declineCount,
          maxDeclinesPerDay,
        };
      }

      return {
        declined: true,
        availabilityStatus: "available",
        cooldownUntil: null,
        declineCount,
        maxDeclinesPerDay,
      };
    },
  );

  return result;
}
