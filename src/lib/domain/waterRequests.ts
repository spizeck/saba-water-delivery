import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { appConfig } from "./config";
import type { WaterRequest, WaterRequestStatus } from "./types";

/**
 * Domain/service layer for water request operations.
 *
 * These functions are the single source of business logic for creating,
 * claiming, and progressing a water request through its lifecycle. Every
 * caller — the resident web UI, the driver web UI, the dispatcher/admin
 * UI, and (later) a WhatsApp integration — must call through these
 * functions rather than writing to Firestore directly.
 */

const REQUESTS_COLLECTION = "waterRequests";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Statuses that mean the request is still "active" (unresolved). */
const ACTIVE_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "delivered_unconfirmed",
  "disputed",
];

function toWaterRequest(id: string, data: DocumentData): WaterRequest {
  return {
    id,
    customerId: data.customerId,
    gallons: data.gallons,
    village: data.village,
    deliveryDirections: data.deliveryDirections,
    preferredDriverId: data.preferredDriverId ?? null,
    preferredDriverExpiresAt:
      data.preferredDriverExpiresAt?.toDate?.().toISOString() ?? null,
    assignedDriverId: data.assignedDriverId ?? null,
    status: data.status,
    requestedAt: data.requestedAt?.toDate?.().toISOString() ?? new Date().toISOString(),
    availableAt: data.availableAt?.toDate?.().toISOString() ?? null,
    claimedAt: data.claimedAt?.toDate?.().toISOString() ?? null,
    deliveredAt: data.deliveredAt?.toDate?.().toISOString() ?? null,
    confirmedAt: data.confirmedAt?.toDate?.().toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries — Resident
// ---------------------------------------------------------------------------

/**
 * Returns the resident's currently active (unresolved) request, or null.
 * Used to enforce the one-active-request-per-resident constraint.
 */
export async function getActiveRequestForCustomer(
  customerId: string,
): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", customerId)
    .where("status", "in", ACTIVE_STATUSES)
    .orderBy("requestedAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return toWaterRequest(doc.id, doc.data());
}

/**
 * Returns all water requests for a given customer, most recent first.
 */
export async function getRequestsForCustomer(
  customerId: string,
): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", customerId)
    .orderBy("requestedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

// ---------------------------------------------------------------------------
// Queries — Driver queue
// ---------------------------------------------------------------------------

/**
 * Returns requests that the given driver is eligible to claim, oldest first.
 *
 * A request is claimable by this driver if:
 *   1. status === "available" (open to any eligible driver), OR
 *   2. status === "preferred_driver_hold" AND preferredDriverId matches this
 *      driver AND the hold has not expired.
 *
 * Preferred-driver holds whose expiration has passed are lazily transitioned
 * to "available" during this read (see `expirePreferredDriverHold`).
 */
export async function getClaimableRequestsForDriver(
  driverId: string,
): Promise<WaterRequest[]> {
  const db = getAdminDb();

  // Fetch "available" requests (open to all).
  const availableSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "available")
    .orderBy("requestedAt", "asc")
    .get();

  // Fetch preferred-driver holds addressed to this specific driver.
  const holdSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverId", "==", driverId)
    .orderBy("requestedAt", "asc")
    .get();

  const results: WaterRequest[] = [];

  // Process available requests.
  for (const doc of availableSnapshot.docs) {
    results.push(toWaterRequest(doc.id, doc.data()));
  }

  // Process preferred-driver holds — check expiration lazily.
  for (const doc of holdSnapshot.docs) {
    const data = doc.data();
    const expiresAt = data.preferredDriverExpiresAt?.toDate?.();

    if (expiresAt && expiresAt <= new Date()) {
      // Hold has expired — transition to "available" lazily.
      await expirePreferredDriverHold({ requestId: doc.id });
      // After expiration it's now "available" and visible to all drivers.
      // Refetch the updated doc.
      const updated = await doc.ref.get();
      if (updated.exists) {
        results.push(toWaterRequest(updated.id, updated.data()!));
      }
    } else {
      // Hold is still active — show to this preferred driver.
      results.push(toWaterRequest(doc.id, data));
    }
  }

  // Also check for expired holds addressed to OTHER drivers (lazy expiration).
  // These would be "preferred_driver_hold" requests whose expiration passed
  // but haven't been transitioned yet — expire them so they become "available".
  const expiredHoldsSnapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "preferred_driver_hold")
    .where("preferredDriverExpiresAt", "<=", new Date())
    .get();

  for (const doc of expiredHoldsSnapshot.docs) {
    // Only expire if not already processed above.
    if (holdSnapshot.docs.some((d) => d.id === doc.id)) continue;
    await expirePreferredDriverHold({ requestId: doc.id });
    // After expiration, refetch and add to results.
    const updated = await doc.ref.get();
    if (updated.exists && updated.data()!.status === "available") {
      results.push(toWaterRequest(updated.id, updated.data()!));
    }
  }

  // Sort all results oldest-first by requestedAt.
  results.sort(
    (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime(),
  );

  return results;
}

/**
 * Returns requests currently claimed by (assigned to) this driver.
 */
export async function getClaimedRequestsForDriver(
  driverId: string,
): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("assignedDriverId", "==", driverId)
    .where("status", "==", "claimed")
    .orderBy("claimedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateWaterRequestInput {
  customerId: string;
  village: string;
  deliveryDirections: string;
  preferredDriverId?: string | null;
}

/**
 * Creates a new water request.
 *
 * Uses a Firestore transaction to atomically verify that the resident
 * does not already have an active request before creating a new one.
 *
 * - Sets gallons to the system standard (1,000).
 * - If a preferred driver is selected, sets status to
 *   "preferred_driver_hold" with the configured expiration window.
 * - Otherwise, sets status to "available" immediately.
 * - Records a "request_created" audit event (and optionally
 *   "preferred_driver_selected").
 */
export async function createWaterRequest(
  input: CreateWaterRequestInput,
): Promise<WaterRequest> {
  const db = getAdminDb();
  const { customerId, village, deliveryDirections, preferredDriverId } = input;

  const hasPreferredDriver = Boolean(preferredDriverId);
  const now = FieldValue.serverTimestamp();

  // Compute the preferred-driver expiration time if applicable.
  const preferredDriverExpiresAt = hasPreferredDriver
    ? new Date(Date.now() + appConfig.preferredDriverWindowHours * 60 * 60 * 1000)
    : null;

  const initialStatus: WaterRequestStatus = hasPreferredDriver
    ? "preferred_driver_hold"
    : "available";

  // Use a transaction to prevent duplicate active requests.
  const requestRef = db.collection(REQUESTS_COLLECTION).doc();

  await db.runTransaction(async (txn) => {
    // Check for existing active request within the transaction.
    const existingSnapshot = await txn.get(
      db
        .collection(REQUESTS_COLLECTION)
        .where("customerId", "==", customerId)
        .where("status", "in", ACTIVE_STATUSES)
        .limit(1),
    );

    if (!existingSnapshot.empty) {
      throw new Error("DUPLICATE_ACTIVE_REQUEST");
    }

    const requestData: Record<string, unknown> = {
      customerId,
      gallons: appConfig.standardLoadGallons,
      village,
      deliveryDirections,
      preferredDriverId: preferredDriverId ?? null,
      preferredDriverExpiresAt: preferredDriverExpiresAt,
      assignedDriverId: null,
      status: initialStatus,
      requestedAt: now,
      availableAt: hasPreferredDriver ? null : now,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    txn.set(requestRef, requestData);

    // Audit event: request_created
    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "request_created",
      actorId: customerId,
      actorRole: "resident",
      createdAt: now,
      metadata: {
        village,
        preferredDriverId: preferredDriverId ?? null,
      },
    });

    // Additional audit event if a preferred driver was selected.
    if (hasPreferredDriver) {
      const prefEventRef = requestRef.collection("events").doc();
      txn.set(prefEventRef, {
        type: "preferred_driver_selected",
        actorId: customerId,
        actorRole: "resident",
        createdAt: now,
        metadata: {
          driverId: preferredDriverId,
          expiresAt: preferredDriverExpiresAt?.toISOString() ?? null,
        },
      });
    }
  });

  // Read back the created document to return the full WaterRequest.
  const created = await requestRef.get();
  return toWaterRequest(requestRef.id, created.data()!);
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export interface ClaimWaterRequestInput {
  requestId: string;
  driverId: string;
}

/**
 * Atomically claims a water request for a driver.
 *
 * Uses a Firestore transaction to guarantee:
 *   - The request exists and is claimable (status "available" or
 *     "preferred_driver_hold" addressed to this driver and not expired).
 *   - No other driver has already claimed it.
 *   - The driver document exists, is eligible, and is online.
 *
 * On success:
 *   - Sets assignedDriverId, status → "claimed", claimedAt, updatedAt.
 *   - Creates a "driver_claimed" audit event.
 *
 * Only one concurrent driver may succeed — the others receive a clean
 * error (CLAIM_FAILED).
 */
export async function claimWaterRequest(
  input: ClaimWaterRequestInput,
): Promise<WaterRequest> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const driverRef = db.collection("drivers").doc(driverId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [requestSnap, driverSnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(driverRef),
    ]);

    // --- Validate request ---
    if (!requestSnap.exists) {
      throw new Error("REQUEST_NOT_FOUND");
    }
    const reqData = requestSnap.data()!;

    if (reqData.assignedDriverId) {
      throw new Error("ALREADY_CLAIMED");
    }

    const status = reqData.status as WaterRequestStatus;

    if (status === "preferred_driver_hold") {
      // Only the preferred driver may claim during the hold.
      if (reqData.preferredDriverId !== driverId) {
        throw new Error("PREFERRED_DRIVER_RESTRICTION");
      }
      // Check if the hold has expired.
      const expiresAt = reqData.preferredDriverExpiresAt?.toDate?.();
      if (expiresAt && expiresAt <= new Date()) {
        throw new Error("HOLD_EXPIRED");
      }
    } else if (status !== "available") {
      throw new Error("REQUEST_NOT_CLAIMABLE");
    }

    // --- Validate driver ---
    if (!driverSnap.exists) {
      throw new Error("DRIVER_NOT_FOUND");
    }
    const drvData = driverSnap.data()!;

    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }
    if (drvData.availabilityStatus !== "online") {
      throw new Error("DRIVER_OFFLINE");
    }

    // --- Perform the claim ---
    txn.update(requestRef, {
      assignedDriverId: driverId,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
    });

    // Audit event
    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "driver_claimed",
      actorId: driverId,
      actorRole: "driver",
      createdAt: now,
      metadata: {
        previousStatus: status,
      },
    });
  });

  const claimed = await requestRef.get();
  return toWaterRequest(requestId, claimed.data()!);
}

// ---------------------------------------------------------------------------
// Preferred-driver hold expiration
// ---------------------------------------------------------------------------

export interface ExpirePreferredDriverHoldInput {
  requestId: string;
}

/**
 * Transitions a request from "preferred_driver_hold" to "available".
 *
 * This is called lazily when the driver queue is read and an expired hold
 * is discovered. It uses a transaction to avoid racing with a claim
 * attempt from the preferred driver.
 */
export async function expirePreferredDriverHold(
  input: ExpirePreferredDriverHoldInput,
): Promise<WaterRequest> {
  const { requestId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) {
      throw new Error("REQUEST_NOT_FOUND");
    }

    const data = snap.data()!;
    // Only expire if still in hold status (another reader may have already expired it).
    if (data.status !== "preferred_driver_hold") return;

    txn.update(requestRef, {
      status: "available",
      availableAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "preferred_driver_expired",
      actorId: null,
      actorRole: null,
      createdAt: now,
      metadata: {
        preferredDriverId: data.preferredDriverId,
        expiredAt: data.preferredDriverExpiresAt?.toDate?.().toISOString() ?? null,
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Mark delivered
// ---------------------------------------------------------------------------

export interface MarkWaterDeliveredInput {
  requestId: string;
  driverId: string;
}

/**
 * Marks a claimed request as delivered.
 *
 * Only the assigned driver may do this. Uses a transaction to prevent
 * race conditions.
 */
export async function markWaterDelivered(
  input: MarkWaterDeliveredInput,
): Promise<WaterRequest> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.status !== "claimed") {
      throw new Error("REQUEST_NOT_CLAIMABLE");
    }
    if (data.assignedDriverId !== driverId) {
      throw new Error("NOT_ASSIGNED_DRIVER");
    }

    txn.update(requestRef, {
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "marked_delivered",
      actorId: driverId,
      actorRole: "driver",
      createdAt: now,
      metadata: null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Customer confirmation
// ---------------------------------------------------------------------------

export interface ConfirmWaterDeliveryInput {
  requestId: string;
  customerId: string;
}

/**
 * Customer confirms they received the delivery.
 *
 * Transitions status from "delivered" to "confirmed". This resolves the
 * request, allowing the customer to create a new one.
 */
export async function confirmWaterDelivery(
  input: ConfirmWaterDeliveryInput,
): Promise<WaterRequest> {
  const { requestId, customerId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.customerId !== customerId) {
      throw new Error("NOT_REQUEST_OWNER");
    }
    if (data.status !== "delivered" && data.status !== "delivered_unconfirmed") {
      throw new Error("INVALID_STATUS_FOR_CONFIRM");
    }

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "customer_confirmed",
      actorId: customerId,
      actorRole: "resident",
      createdAt: now,
      metadata: null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Customer dispute
// ---------------------------------------------------------------------------

export interface DisputeWaterDeliveryInput {
  requestId: string;
  customerId: string;
  reason?: string;
}

/**
 * Customer disputes that the delivery was received correctly.
 *
 * Transitions status to "disputed". The request remains unresolved and
 * blocks a new request until it is resolved by government staff.
 */
export async function disputeWaterDelivery(
  input: DisputeWaterDeliveryInput,
): Promise<WaterRequest> {
  const { requestId, customerId, reason } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.customerId !== customerId) {
      throw new Error("NOT_REQUEST_OWNER");
    }
    if (data.status !== "delivered" && data.status !== "delivered_unconfirmed") {
      throw new Error("INVALID_STATUS_FOR_DISPUTE");
    }

    txn.update(requestRef, {
      status: "disputed",
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "customer_disputed",
      actorId: customerId,
      actorRole: "resident",
      createdAt: now,
      metadata: reason ? { reason } : null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Delivered-unconfirmed timeout (lazy expiration)
// ---------------------------------------------------------------------------

/**
 * Checks if a "delivered" request has exceeded the confirmation window and
 * lazily transitions it to "delivered_unconfirmed" if so.
 *
 * Call this when reading a request's status for display. Does nothing if
 * the request is not in "delivered" status or if the window hasn't passed.
 */
export async function checkDeliveryConfirmationTimeout(
  requestId: string,
): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);

  const snap = await requestRef.get();
  if (!snap.exists) return null;

  const data = snap.data()!;
  if (data.status !== "delivered") {
    return toWaterRequest(requestId, data);
  }

  const deliveredAt = data.deliveredAt?.toDate?.();
  if (!deliveredAt) return toWaterRequest(requestId, data);

  const windowMs = appConfig.deliveryConfirmationWindowHours * 60 * 60 * 1000;
  const expiresAt = new Date(deliveredAt.getTime() + windowMs);

  if (new Date() < expiresAt) {
    // Still within confirmation window.
    return toWaterRequest(requestId, data);
  }

  // Expired — transition to delivered_unconfirmed.
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (txn) => {
    const freshSnap = await txn.get(requestRef);
    if (!freshSnap.exists) return;
    const freshData = freshSnap.data()!;

    // Only transition if still in "delivered" (prevent double-transition race).
    if (freshData.status !== "delivered") return;

    txn.update(requestRef, {
      status: "delivered_unconfirmed",
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "delivery_confirmation_expired",
      actorId: null,
      actorRole: null,
      createdAt: now,
      metadata: {
        deliveredAt: deliveredAt.toISOString(),
        windowHours: appConfig.deliveryConfirmationWindowHours,
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Remaining stubs (not yet implemented)
// ---------------------------------------------------------------------------

export interface CancelWaterRequestInput {
  requestId: string;
  actorId: string;
  reason?: string;
}

export async function cancelWaterRequest(
  _input: CancelWaterRequestInput,
): Promise<WaterRequest> {
  throw new Error("cancelWaterRequest is not implemented yet.");
}
