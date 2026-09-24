import "server-only";

import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger } from "@/lib/logging";

import {
  buildDispatchRecord,
  driverOffersCollection,
  expirePendingOffersForDriver,
  getDeclinedRequestIdsForDriver,
} from "./driverOffers";
import { sabaCalendarDateKey, startOfSabaDay } from "@/lib/utils/datetime";
import { appConfig } from "./config";
import { PRIORITY_RANK, priorityRankFor } from "./priority";
import type { DispatchPriority, WaterRequest } from "./types";
import {
  isAssignableToDriver,
  selectNextDispatchCandidate,
} from "./dispatchSelection";
import {
  getDriverByLinkedUserId,
  reconcileActiveRequestByUserId,
} from "./driverRegistry";
import {
  claimWaterRequest,
  expirePreferredDriverHolds,
  getClaimedRequestsForDriver,
  toWaterRequest,
} from "./waterRequests";

/**
 * Dispatch orchestration layer implementing the one-assignment-at-a-time
 * driver workflow (see PRODUCT.md "Dispatch Assignment" and TECHNICAL.md
 * "Dispatch Assignment").
 *
 * Issue #123 (assignment-on-visibility): this module decides WHICH
 * request to assign a driver next AND performs the assignment in the
 * same step, via the atomic `claimWaterRequest()` transaction. A driver
 * is never shown a delivery's details before it is authoritatively
 * theirs — the request stops being dispatchable the moment it can be
 * displayed. There is no "accept" step and no offer lease; only an
 * explicit release (`releaseAssignedDelivery`) or a staff workflow can
 * unassign the request.
 *
 * `driverOffers` records are the append-only dispatch-decision ledger:
 * `"assigned"` records are created resolved inside the claim
 * transaction, and a release appends a `"declined"` record.
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
 * Total documents a single `assignNextDeliveryForDriver` call may read
 * across ALL candidate streams (holds + available + the legacy
 * catch-all). Bounds a selection attempt — far beyond Saba's realistic
 * queue size — while still making a pathological queue terminate instead
 * of scanning unboundedly. Reaching this bound is a safety stop, not a
 * completeness result; it is logged as `dispatch.candidate_scan_exhausted`
 * so an inconclusive selection is observable in operational telemetry.
 */
const MAX_CANDIDATE_DOCS = 1000;

/**
 * Maximum number of claim attempts per assignment pass. Selection is
 * advisory — a concurrently-claimed or concurrently-cancelled candidate
 * fails its `claimWaterRequest` transaction, and the loop moves on to
 * the next eligible candidate. The bound keeps a pathological queue
 * (or a sustained race storm) from retrying forever; normal operation
 * succeeds on the first attempt.
 */
const MAX_ASSIGNMENT_ATTEMPTS = 5;

/**
 * Claim failures that mean "this candidate is gone" — the request was
 * claimed, cancelled, held for someone else, or deleted between the
 * advisory selection and the authoritative transaction. Safe to retry
 * with the next candidate.
 */
const RETRYABLE_CLAIM_ERRORS = new Set([
  "REQUEST_NOT_FOUND",
  "ALREADY_CLAIMED",
  "REQUEST_NOT_CLAIMABLE",
  "HOLD_EXPIRED",
  "PREFERRED_DRIVER_RESTRICTION",
]);

/**
 * Claim failures that mean "this DRIVER cannot take work right now" —
 * retrying another candidate would fail identically, so the pass ends.
 */
const DRIVER_STATE_CLAIM_ERRORS = new Set([
  "DRIVER_NOT_FOUND",
  "DRIVER_INELIGIBLE",
  "DRIVER_OFFLINE",
  "DRIVER_IN_COOLDOWN",
  "DRIVER_HAS_ACTIVE_DELIVERY",
]);

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
// Automatic assignment (issue #123 — assignment-on-visibility)
// ---------------------------------------------------------------------------

/**
 * The driver's current normal (non-delivery-run) assignment, if any.
 */
async function currentNormalAssignment(
  driverId: string,
): Promise<WaterRequest | null> {
  const claimed = await getClaimedRequestsForDriver(driverId);
  return claimed.find((r) => !r.dispatchBatchId) ?? null;
}

/**
 * Returns the request currently assigned to this driver for normal
 * dispatch — an existing assignment if one is already active, otherwise
 * the next eligible request, claimed atomically before it is returned.
 *
 * Assignment-on-visibility invariant (issue #123): the returned request
 * is always already `claimed` and assigned to THIS driver. The function
 * never returns a request that is merely "offered" or still available —
 * full customer/delivery details may only ever be rendered from a
 * successfully assigned request.
 *
 * Returns null when there is nothing assignable: empty/ineligible queue,
 * driver not currently dispatchable, or every claim attempt lost a race
 * within the attempt bound.
 *
 * Selection order per attempt (unchanged from the offer model):
 *   1. A preferred-driver hold addressed to this driver (not expired).
 *   2. The highest-ranked "available" request this driver has not
 *      recently declined/released, in canonical dispatch order.
 *
 * A candidate that fails the authoritative claim (claimed by another
 * driver, cancelled, or otherwise resolved between selection and claim)
 * is skipped and the NEXT eligible candidate is attempted, bounded by
 * MAX_ASSIGNMENT_ATTEMPTS — a lost race never returns "nothing
 * available" while other work remains.
 *
 * Idempotent: reopening/refreshing the portal after assignment returns
 * the same claimed request; closing the app never releases it. Only
 * `releaseAssignedDelivery`, a staff workflow, or completing the
 * delivery can end the assignment.
 */
export async function assignNextDeliveryForDriver(
  driverId: string,
): Promise<WaterRequest | null> {
  const now = new Date();
  const db = getAdminDb();

  // Driver-state gate: automatic assignment must never target an
  // offline, ineligible, unlinked, or cooldown driver — regardless of
  // which caller invoked the pass. `claimWaterRequest` re-enforces the
  // transactional subset of this; the early read keeps the failure cheap
  // and keeps cooldown (a caller-side policy, not a claim condition)
  // enforced at the domain boundary too.
  const entry = await getDriverByLinkedUserId(driverId);
  if (!entry) return null;
  if (entry.archivedAt) return null;
  if (entry.eligibilityStatus !== "eligible") return null;
  if (entry.availabilityStatus !== "online") return null;
  if (entry.cooldownUntil && new Date(entry.cooldownUntil) > now) {
    return null;
  }

  // Reconcile stale activeRequestId before checking claimed deliveries.
  // If the lock points to a deleted/completed/reassigned request, clear
  // it so the driver is not permanently blocked from assignment.
  await reconcileActiveRequestByUserId(driverId);

  // Deployment reconciliation (issue #123): pending offers are a legacy
  // concept. Any `response == null` records left over from the old model
  // are expired unconditionally — they never reserved the request, and
  // under assignment-on-visibility they must never be treated as
  // meaningful again. Idempotent; touches offer records only, never the
  // request.
  await expirePendingOffersForDriver(driverId);

  // Existing claimed work blocks a new assignment — a driver holds at
  // most one normal assignment at a time, and any claimed delivery
  // (including delivery-run loads) occupies that slot. Returns the
  // existing normal assignment so a refresh/reopen is idempotent.
  const claimed = await getClaimedRequestsForDriver(driverId);
  if (claimed.length > 0) {
    return claimed.find((r) => !r.dispatchBatchId) ?? null;
  }

  // Request IDs this driver declined/released within the recent window.
  const declinedIds = await getDeclinedRequestIdsForDriver(driverId);

  // Opportunistic maintenance: expire any preferred-driver holds that
  // have passed their window, regardless of which driver triggered this
  // read (mirrors the previous lazy-expiration behavior).
  await expirePreferredDriverHolds(now);

  // Candidate scans share one page budget so a single assignment pass is
  // bounded across every stream it consults.
  const budget: CandidateScanBudget = { docsScanned: 0, exhausted: false };

  for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt++) {
    // Priority 1: the canonically-first preferred-driver hold addressed
    // to this driver that is still assignable (not expired).
    const holdCandidate = await findFirstCandidate(
      { status: "preferred_driver_hold", preferredDriverId: driverId },
      (request) => isAssignableToDriver(request, driverId, now),
      budget,
    );

    // Priority 2: the canonically-first available request this driver
    // has not recently declined — see PRODUCT.md "Priority-Based
    // Dispatch".
    const availableCandidate = holdCandidate
      ? null
      : await findFirstCandidate(
          { status: "available" },
          (request) =>
            isAssignableToDriver(request, driverId, now) &&
            !declinedIds.has(request.id),
          budget,
        );

    const candidate = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: holdCandidate ? [holdCandidate] : [],
      available: availableCandidate ? [availableCandidate] : [],
      declinedRequestIds: declinedIds,
      driverId,
      now,
    });

    if (!candidate) {
      if (budget.exhausted) {
        // The scan hit its safety bound with unread candidates
        // remaining: "no assignment" here is inconclusive — eligible
        // work may exist beyond the bound. Surface it operationally;
        // never silently. Counts only — no request IDs or customer data.
        logger.warn("dispatch.candidate_scan_exhausted", {
          driverId,
          docsScanned: budget.docsScanned,
          docLimit: MAX_CANDIDATE_DOCS,
        });
      }
      return null;
    }

    try {
      // THE authoritative step: the request is claimed and the dispatch
      // record is written in the same transaction. Only the post-claim
      // snapshot is ever returned — a request that failed assignment is
      // never exposed as a driver-visible delivery.
      return await claimWaterRequest(
        { requestId: candidate.id, driverId },
        {
          claimEventMetadata: { assignmentMode: "automatic" },
          additionalWrites: (txn) => {
            txn.set(
              driverOffersCollection(db).doc(),
              buildDispatchRecord(driverId, candidate.id, "assigned"),
            );
          },
        },
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (RETRYABLE_CLAIM_ERRORS.has(code)) {
        // The candidate was claimed/cancelled/held concurrently — keep
        // going; the next scan sees the committed state and moves to
        // the next eligible request.
        continue;
      }
      if (DRIVER_STATE_CLAIM_ERRORS.has(code)) {
        // Driver became non-dispatchable mid-pass (e.g. a dispatcher
        // assigned them concurrently, or they went offline). Whatever
        // committed is authoritative — re-read and return it.
        return currentNormalAssignment(driverId);
      }
      throw err;
    }
  }

  // Every attempt lost a race. This is a safety stop, not "queue empty" —
  // log it so the inconclusive outcome is observable.
  logger.warn("dispatch.assignment_attempts_exhausted", {
    driverId,
    attempts: MAX_ASSIGNMENT_ATTEMPTS,
  });
  return null;
}

// ---------------------------------------------------------------------------
// Decline / release (issue #123)
// ---------------------------------------------------------------------------

export interface ReleaseAssignedDeliveryInput {
  requestId: string;
  driverId: string;
}

export interface ReleaseAssignedDeliveryResult {
  released: true;
  availabilityStatus: "available" | "cooldown" | "daily_limit";
  cooldownUntil: string | null;
  declineCount: number;
  maxDeclinesPerDay: number;
}

/**
 * Driver-initiated release of an ASSIGNED delivery: the operational
 * replacement for declining an unclaimed offer (issue #123).
 *
 * Atomically:
 *   1. verifies the caller is the currently assigned driver and the
 *      request is still releasable (`claimed`, no recorded water
 *      collection, not part of a delivery run);
 *   2. returns the request to `available` at its ORIGINAL `requestedAt`
 *      priority — releasing never moves a customer to the back of the
 *      queue, and a formerly preferred-driver request enters the general
 *      queue rather than being re-reserved for this driver;
 *   3. clears the driver's `activeRequestId` lock (only if it points at
 *      this request);
 *   4. appends a `"declined"` dispatch record and expires any leftover
 *      legacy pending offers for the pair;
 *   5. applies the existing decline policy exactly once — daily decline
 *      counting and cooldown start are unchanged from the offer model;
 *   6. records a `driver_released` audit event.
 *
 * A stale browser can never release work that has since been delivered,
 * cancelled, or reassigned: the status/ownership checks re-run against
 * committed state inside the transaction.
 */
export async function releaseAssignedDelivery(
  input: ReleaseAssignedDeliveryInput,
): Promise<ReleaseAssignedDeliveryResult> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const offers = driverOffersCollection(db);

  const now = new Date();
  const endOfToday = startOfSabaDay(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );

  return db.runTransaction<ReleaseAssignedDeliveryResult>(async (txn) => {
    // ---- All reads first ----
    const requestSnap = await txn.get(requestRef);
    if (!requestSnap.exists) throw new Error("REQUEST_NOT_FOUND");
    const reqData = requestSnap.data()!;

    if (reqData.status !== "claimed") {
      throw new Error("REQUEST_NOT_RELEASABLE");
    }
    if (reqData.assignedDriverId !== driverId) {
      throw new Error("NOT_ASSIGNED_DRIVER");
    }
    if (reqData.dispatchBatchId) {
      // Delivery-run loads are staff-managed; a driver cannot detach
      // themselves from a run.
      throw new Error("DELIVERY_RUN_MANAGED");
    }
    if (
      Array.isArray(reqData.loadCollections) &&
      reqData.loadCollections.length > 0
    ) {
      // Water is already physically collected — releasing now would
      // strand collected water. Staff must resolve this by hand.
      throw new Error("REQUEST_HAS_COLLECTIONS");
    }

    const registrySnap = await txn.get(
      db
        .collection("driverRegistry")
        .where("linkedUserId", "==", driverId)
        .limit(1),
    );
    if (registrySnap.empty) throw new Error("DRIVER_NOT_FOUND");
    const registryRef = registrySnap.docs[0].ref;
    const registryData = registrySnap.docs[0].data();

    // Leftover pending (legacy) offers for this pair — expire them so a
    // stale record can never resurface the request to this driver.
    const legacyPendingSnap = await txn.get(
      offers
        .where("driverId", "==", driverId)
        .where("requestId", "==", requestId)
        .where("response", "==", null),
    );

    const settingsSnap = await txn.get(
      db.collection("config").doc("dispatchSettings"),
    );
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

    // Count declines already recorded today (this release is not yet
    // recorded — appended below exactly once).
    const lookback = new Date(now.getTime() - 26 * 60 * 60 * 1000);
    const declinesSnap = await txn.get(
      offers
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

    // ---- All writes after reads ----
    const nowField = FieldValue.serverTimestamp();

    // 1. Return the request to the general dispatch queue. `requestedAt`
    //    and `dispatchPriority`/`dispatchOverrideRank` are untouched —
    //    the customer keeps their place. `preferredDriverId`/
    //    `preferredDriverExpiresAt` are cleared (same as the staff
    //    return-to-queue path): the hold is never re-established for the
    //    releasing driver, and the fresh decline record excludes
    //    re-assignment to them for the decline window regardless.
    txn.update(requestRef, {
      status: "available",
      assignedDriverId: null,
      claimedAt: null,
      availableAt: nowField,
      preferredDriverId: null,
      preferredDriverExpiresAt: null,
      updatedAt: nowField,
    });

    // 2. Clear the driver's active-delivery lock — only if it currently
    //    points at this request (same convention as markWaterDelivered).
    if (registryData.activeRequestId === requestId) {
      txn.update(registryRef, {
        activeRequestId: null,
        updatedAt: nowField,
        updatedBy: driverId,
      });
    }

    // 3. Expire any leftover pending offer records for the pair.
    for (const doc of legacyPendingSnap.docs) {
      txn.update(doc.ref, {
        response: "expired",
        respondedAt: nowField,
      });
    }

    // 4. Append the decline dispatch record — exactly once.
    txn.set(offers.doc(), buildDispatchRecord(driverId, requestId, "declined"));

    // 5. Audit event on the request.
    txn.set(requestRef.collection("events").doc(), {
      type: "driver_released",
      actorId: driverId,
      actorRole: "driver",
      createdAt: nowField,
      metadata: { previousStatus: "claimed" },
    });

    // 6. Cooldown if the daily decline limit is now reached.
    const declineCount = declinesBeforeThis + 1;
    if (willEnterCooldown) {
      const cooldownUntil = new Date(
        now.getTime() + declineCooldownHours * 60 * 60 * 1000,
      );

      txn.update(registryRef, {
        cooldownUntil,
        updatedAt: nowField,
        updatedBy: driverId,
      });

      txn.set(registryRef.collection("events").doc(), {
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

      return {
        released: true,
        availabilityStatus:
          cooldownUntil.getTime() >= endOfToday.getTime()
            ? "daily_limit"
            : "cooldown",
        cooldownUntil: cooldownUntil.toISOString(),
        declineCount,
        maxDeclinesPerDay,
      };
    }

    return {
      released: true,
      availabilityStatus: "available",
      cooldownUntil: null,
      declineCount,
      maxDeclinesPerDay,
    };
  });
}
