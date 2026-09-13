/**
 * Pure eligibility rules for resident self-service request cancellation
 * (issue #23) — deliberately free of Firestore/`server-only`
 * dependencies so the SAME rule drives both the server-side transaction
 * in `cancelOwnWaterRequest()` and the resident UI's button visibility,
 * and so it is testable without a database.
 *
 * See PRODUCT.md "Cancelling a Request" and TECHNICAL.md "Resident
 * Self-Service Cancellation".
 */

import type { WaterRequestStatus } from "./types";

/**
 * The canonical statuses in which a request is still genuinely
 * pre-dispatch: no driver has physically committed to it yet. Once a
 * request is `claimed` it is inside physical delivery operations — from
 * there only staff may cancel (`cancelWaterRequest()`).
 */
export const RESIDENT_CANCELLABLE_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
];

/**
 * True only when the request is still genuinely pre-dispatch. The
 * status list alone is deliberately NOT the whole rule: a request that
 * carries an assigned driver or a delivery-run commitment is inside
 * physical delivery operations even if its stored status looks
 * superficially eligible (stale or inconsistent data), and a resident
 * cancellation must never silently detach it.
 */
export function isResidentCancellableRequest(request: {
  status: WaterRequestStatus;
  assignedDriverId: string | null;
  dispatchBatchId?: string | null;
}): boolean {
  if (!RESIDENT_CANCELLABLE_STATUSES.includes(request.status)) return false;
  if (request.assignedDriverId) return false;
  if (request.dispatchBatchId) return false;
  return true;
}
