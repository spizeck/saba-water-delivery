import "server-only";

import { type DocumentReference, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import {
  createDriverOffer,
  getDeclinedRequestIdsForDriver,
  getPendingOfferForDriver,
  recordOfferResponse,
} from "./driverOffers";
import { sabaCalendarDateKey } from "@/lib/utils/datetime";
import { appConfig } from "./config";
import type { DriverOffer, WaterRequest } from "./types";
import {
  dispatchQueueCompare,
} from "./dispatchBatchSelection";
import {
  isOfferableToDriver,
  selectNextDispatchCandidate,
} from "./dispatchSelection";
import { reconcileActiveRequestByUserId } from "./driverRegistry";
import {
  claimWaterRequest,
  expirePreferredDriverHold,
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
 *      by dispatch priority, then oldest request first.
 *   2. Otherwise, the highest dispatch-priority "available" request this
 *      driver has not already declined, oldest first within the same
 *      priority (see PRODUCT.md "Priority-Based Dispatch" /
 *      TECHNICAL.md "Priority-Aware Selection") — critical requests
 *      before urgent, urgent before normal, and fairness-by-age
 *      preserved within each level. Ordering uses the denormalized
 *      numeric `priorityRank` field (see `src/lib/domain/priority.ts`)
 *      because "critical" < "urgent" < "normal" alphabetically would
 *      not match the intended order.
 *
 * Callers must ensure the driver is online, eligible, and not in a
 * decline cooldown before calling this — those are prerequisites for
 * receiving offers at all, not part of request selection itself.
 */
export async function getNextOfferForDriver(driverId: string): Promise<NextOffer | null> {
  const db = getAdminDb();
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
  const expiredHoldsSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverExpiresAt", "<=", now)
    .limit(10)
    .get();
  for (const doc of expiredHoldsSnapshot.docs) {
    await expirePreferredDriverHold({ requestId: doc.id });
  }

  // Priority 1: preferred-driver hold addressed to this driver. Ordered
  // by dispatch priority first, then oldest request first, in case more
  // than one hold is ever addressed to the same driver.
  const holdSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverId", "==", driverId)
    .orderBy("priorityRank", "asc")
    .orderBy("requestedAt", "asc")
    .limit(1)
    .get();
  const holds = holdSnapshot.docs
    .map((doc) => toWaterRequest(doc.id, doc.data()))
    .sort(dispatchQueueCompare);

  // Priority 2: highest dispatch-priority open request not already
  // declined by this driver recently, oldest first within the same
  // priority level — see PRODUCT.md "Priority-Based Dispatch".
  const availableSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "available")
    .orderBy("priorityRank", "asc")
    .orderBy("requestedAt", "asc")
    .limit(100)
    .get();
  const available = availableSnapshot.docs
    .map((doc) => toWaterRequest(doc.id, doc.data()))
    .sort(dispatchQueueCompare);

  const candidate = selectNextDispatchCandidate({
    activeDelivery,
    pendingOffer: pendingPair,
    holds,
    available,
    declinedRequestIds: declinedIds,
    driverId,
    now,
  });

  if (!candidate) return null;

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
  enteredCooldown: boolean;
  cooldownUntil: string | null;
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

  /**
   * Single Firestore transaction for the entire decline consequence:
   *   - record offer as declined
   *   - release a preferred-driver hold if applicable
   *   - count today's declines (including this one)
   *   - start a cooldown on the driver registry if threshold reached
   *   - write all relevant audit events
   *
   * This guarantees the driver cannot receive further offers while a
   * cooldown is due, and the request remains correctly dispatchable.
   */
  const result = await db.runTransaction<DeclineDriverOfferResult>(async (txn) => {
    // ---- All reads first ----
    const offerSnap = await txn.get(offerRef);
    if (!offerSnap.exists) throw new Error("OFFER_NOT_FOUND");
    const offerData = offerSnap.data()!;
    if (offerData.driverId !== driverId) throw new Error("OFFER_NOT_FOUND");
    if (offerData.response !== null) throw new Error("OFFER_ALREADY_RESOLVED");

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
      typeof settingsData.maxDeclinesPerDay === "number" && settingsData.maxDeclinesPerDay >= 1
        ? settingsData.maxDeclinesPerDay
        : appConfig.defaultMaxDeclinesPerDay;
    const declineCooldownHours =
      typeof settingsData.declineCooldownHours === "number" && settingsData.declineCooldownHours > 0
        ? settingsData.declineCooldownHours
        : appConfig.defaultDeclineCooldownHours;

    // Count declines already recorded today (this offer is not yet declined).
    const lookback = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const declinesSnap = await txn.get(
      db
        .collection("driverOffers")
        .where("driverId", "==", driverId)
        .where("response", "==", "declined")
        .where("respondedAt", ">=", lookback),
    );
    const todayKey = sabaCalendarDateKey(new Date());
    const declinesBeforeThis = declinesSnap.docs.filter((doc) => {
      const respondedAt = doc.data().respondedAt?.toDate?.();
      return respondedAt instanceof Date && sabaCalendarDateKey(respondedAt) === todayKey;
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
    const now = FieldValue.serverTimestamp();

    // 1. Record the offer as declined; expire duplicate pending offers of
    // the same request so only one decline is counted.
    txn.update(offerRef, {
      response: "declined",
      respondedAt: now,
    });
    for (const doc of duplicatePendingSnap.docs) {
      if (doc.id === offerId) continue;
      txn.update(doc.ref, {
        response: "expired",
        respondedAt: now,
      });
    }

    // 2. Release an active preferred-driver hold to the general queue.
    if (requestSnap.exists) {
      const requestData = requestSnap.data()!;
      if (requestData.status === "preferred_driver_hold" && requestData.preferredDriverId === driverId) {
        const requestUpdate: Record<string, unknown> = {
          availableAt: now,
          updatedAt: now,
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
          createdAt: now,
          metadata: { preferredDriverId: driverId },
        });
      }
    }

    // 3. Start cooldown if threshold reached.
    if (willEnterCooldown) {
      if (!registryRef) {
        // Cannot set a cooldown without a linked registry record. This should
        // not happen for a driver receiving offers, so treat it as a data
        // integrity error and abort the entire transaction.
        throw new Error("DRIVER_NOT_LINKED_FOR_COOLDOWN");
      }

      const cooldownUntil = new Date(Date.now() + declineCooldownHours * 60 * 60 * 1000);
      txn.update(registryRef, {
        cooldownUntil,
        updatedAt: now,
        updatedBy: driverId,
      });

      const cooldownEventRef = registryRef.collection("events").doc();
      txn.set(cooldownEventRef, {
        type: "driver_cooldown_started",
        actorId: driverId,
        actorRole: "driver",
        createdAt: now,
        metadata: {
          declineCount: declinesBeforeThis + 1,
          maxDeclinesPerDay,
          cooldownUntil: cooldownUntil.toISOString(),
        },
      });

      return {
        enteredCooldown: true,
        cooldownUntil: cooldownUntil.toISOString(),
      };
    }

    return { enteredCooldown: false, cooldownUntil: null };
  });

  return result;
}
