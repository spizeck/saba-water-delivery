import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import {
  countDeclinesToday,
  createDriverOffer,
  getDeclinedRequestIdsForDriver,
  getPendingOfferForDriver,
  recordOfferResponse,
} from "./driverOffers";
import { getDispatchSettings } from "./dispatchSettings";
import { startDriverCooldown } from "./drivers";
import type { DriverOffer, WaterRequest } from "./types";
import {
  claimWaterRequest,
  expirePreferredDriverHold,
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

/** True if `request` is still valid to show as an offer to `driverId`. */
function isOfferableToDriver(request: WaterRequest, driverId: string): boolean {
  if (request.assignedDriverId) return false;
  if (request.status === "available") return true;
  if (request.status === "preferred_driver_hold" && request.preferredDriverId === driverId) {
    if (!request.preferredDriverExpiresAt) return true;
    return new Date(request.preferredDriverExpiresAt) > new Date();
  }
  return false;
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
 *   2. The oldest "available" request this driver has not already
 *      declined (fairness by request age — see PRODUCT.md "Open Request
 *      Queue").
 *
 * Callers must ensure the driver is online, eligible, and not in a
 * decline cooldown before calling this — those are prerequisites for
 * receiving offers at all, not part of request selection itself.
 */
export async function getNextOfferForDriver(driverId: string): Promise<NextOffer | null> {
  const db = getAdminDb();

  // Reuse an existing pending offer so reloading the page doesn't
  // manufacture a new offer while one is awaiting a response.
  const pending = await getPendingOfferForDriver(driverId);
  if (pending) {
    const request = await getWaterRequestById(pending.requestId);
    if (request && isOfferableToDriver(request, driverId)) {
      return { offer: pending, request };
    }
    // The request was claimed/cancelled/reassigned out from under this
    // offer before the driver responded — expire it and select fresh.
    await recordOfferResponse(pending.id, "expired");
  }

  // Opportunistic maintenance: expire any preferred-driver holds that have
  // passed their window, regardless of which driver triggered this read.
  // This keeps the general queue populated without a separate scheduled
  // job (mirrors the previous browsable-queue behavior).
  const expiredHoldsSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverExpiresAt", "<=", new Date())
    .limit(10)
    .get();
  for (const doc of expiredHoldsSnapshot.docs) {
    await expirePreferredDriverHold({ requestId: doc.id });
  }

  // Priority 1: preferred-driver hold addressed to this driver.
  let candidate: WaterRequest | null = null;
  const holdSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverId", "==", driverId)
    .orderBy("requestedAt", "asc")
    .limit(1)
    .get();

  if (!holdSnapshot.empty) {
    const doc = holdSnapshot.docs[0];
    const data = doc.data();
    const expiresAt = data.preferredDriverExpiresAt?.toDate?.();
    if (!expiresAt || expiresAt > new Date()) {
      candidate = toWaterRequest(doc.id, data);
    }
  }

  // Priority 2: oldest open request not already declined by this driver.
  if (!candidate) {
    const declinedIds = await getDeclinedRequestIdsForDriver(driverId);
    const availableSnapshot = await db
      .collection(REQUESTS_COLLECTION)
      .where("status", "==", "available")
      .orderBy("requestedAt", "asc")
      .limit(25)
      .get();

    for (const doc of availableSnapshot.docs) {
      if (declinedIds.has(doc.id)) continue;
      candidate = toWaterRequest(doc.id, doc.data());
      break;
    }
  }

  if (!candidate) return null;

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
  const offerSnap = await offerRef.get();

  if (!offerSnap.exists) throw new Error("OFFER_NOT_FOUND");
  const offerData = offerSnap.data()!;
  if (offerData.driverId !== driverId) throw new Error("OFFER_NOT_FOUND");
  if (offerData.response !== null) throw new Error("OFFER_ALREADY_RESOLVED");

  const requestId = offerData.requestId as string;

  await recordOfferResponse(offerId, "declined");

  // Release a preferred-driver hold immediately on decline.
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    if (data.status !== "preferred_driver_hold" || data.preferredDriverId !== driverId) {
      return;
    }

    const now = FieldValue.serverTimestamp();
    txn.update(requestRef, {
      status: "available",
      availableAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "preferred_driver_declined",
      actorId: driverId,
      actorRole: "driver",
      createdAt: now,
      metadata: { preferredDriverId: driverId },
    });
  });

  // Decline-limit / cooldown enforcement, using centrally configured,
  // admin-editable settings.
  const settings = await getDispatchSettings();
  const declineCount = await countDeclinesToday(driverId);

  if (declineCount >= settings.maxDeclinesPerDay) {
    const cooldownUntil = new Date(
      Date.now() + settings.declineCooldownHours * 60 * 60 * 1000,
    );
    await startDriverCooldown({
      driverId,
      cooldownUntil,
      declineCount,
      maxDeclinesPerDay: settings.maxDeclinesPerDay,
    });
    return { enteredCooldown: true, cooldownUntil: cooldownUntil.toISOString() };
  }

  return { enteredCooldown: false, cooldownUntil: null };
}
