/**
 * Pure validation logic for the driver registry `activeRequestId` lock.
 *
 * Determines whether a driver's `activeRequestId` is stale (points to a
 * request that no longer represents active driver work) and, if so, why.
 * This module is intentionally free of Firestore or `server-only`
 * dependencies so the validation rules are testable with Vitest.
 *
 * The canonical rule: `activeRequestId` is valid only when the
 * referenced request (1) exists, (2) has status "claimed", (3) is
 * assigned to that same driver. Every other state is stale.
 */

import type { WaterRequestStatus } from "./types";

// ---------------------------------------------------------------------------
// Canonical active-driver-work definition
// ---------------------------------------------------------------------------

/**
 * A request counts as open physical driver work ONLY when the driver still
 * has something to physically deliver. Resident confirmation is
 * independent: once a driver marks a request `delivered`, that driver is no
 * longer busy with it, even if the resident has not yet confirmed.
 */
export function isPhysicallyActiveDriverWork(status: WaterRequestStatus): boolean {
  return status === "claimed";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaleReason =
  | "request_missing"
  | "not_active"
  | "reassigned"
  | "delivered"
  | "cancelled"
  | "confirmed"
  | "disputed";

export interface StaleActiveRequest {
  stale: true;
  reason: StaleReason;
}

export interface ValidActiveRequest {
  stale: false;
}

export type ActiveRequestCheck = StaleActiveRequest | ValidActiveRequest;

/**
 * Snapshot of the referenced request needed for the staleness check.
 * `null` means the request document does not exist (deleted).
 */
export interface ReferencedRequestSnapshot {
  status: WaterRequestStatus;
  assignedDriverId: string | null;
}

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

/**
 * Given a driver's `activeRequestId` and a snapshot of the referenced
 * request, determines whether the lock is stale.
 *
 * @param driverUserId  The Firebase uid of the linked driver account
 *                      (the value stored in `driverRegistry.linkedUserId`).
 * @param snapshot      The referenced request's status and assignedDriverId,
 *                      or `null` if the request document is missing.
 */
export function checkActiveRequestValidity(
  driverUserId: string,
  snapshot: ReferencedRequestSnapshot | null,
): ActiveRequestCheck {
  if (!snapshot) {
    return { stale: true, reason: "request_missing" };
  }

  if (snapshot.assignedDriverId !== driverUserId) {
    return { stale: true, reason: "reassigned" };
  }

  switch (snapshot.status) {
    case "claimed":
      return { stale: false };
    case "delivered":
      return { stale: true, reason: "delivered" };
    case "cancelled":
      return { stale: true, reason: "cancelled" };
    case "confirmed":
      return { stale: true, reason: "confirmed" };
    case "disputed":
      return { stale: true, reason: "disputed" };
    default:
      // requested, preferred_driver_hold, available — driver no longer
      // owns the request even if assignedDriverId somehow still matches.
      return { stale: true, reason: "not_active" };
  }
}
