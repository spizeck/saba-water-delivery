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
// Queries
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
// Remaining stubs (not yet implemented for this phase)
// ---------------------------------------------------------------------------

export interface ClaimWaterRequestInput {
  requestId: string;
  driverId: string;
}

export async function claimWaterRequest(
  _input: ClaimWaterRequestInput,
): Promise<WaterRequest> {
  // Must be implemented as a Firestore transaction. See TECHNICAL.md
  // "Request Claiming" — never read-check-write outside a transaction.
  throw new Error("claimWaterRequest is not implemented yet.");
}

export interface MarkWaterDeliveredInput {
  requestId: string;
  driverId: string;
}

export async function markWaterDelivered(
  _input: MarkWaterDeliveredInput,
): Promise<WaterRequest> {
  throw new Error("markWaterDelivered is not implemented yet.");
}

export interface ConfirmWaterDeliveryInput {
  requestId: string;
  customerId: string;
}

export async function confirmWaterDelivery(
  _input: ConfirmWaterDeliveryInput,
): Promise<WaterRequest> {
  throw new Error("confirmWaterDelivery is not implemented yet.");
}

export interface DisputeWaterDeliveryInput {
  requestId: string;
  customerId: string;
  reason?: string;
}

export async function disputeWaterDelivery(
  _input: DisputeWaterDeliveryInput,
): Promise<WaterRequest> {
  throw new Error("disputeWaterDelivery is not implemented yet.");
}

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

export interface ExpirePreferredDriverHoldInput {
  requestId: string;
}

export async function expirePreferredDriverHold(
  _input: ExpirePreferredDriverHoldInput,
): Promise<WaterRequest> {
  throw new Error("expirePreferredDriverHold is not implemented yet.");
}
