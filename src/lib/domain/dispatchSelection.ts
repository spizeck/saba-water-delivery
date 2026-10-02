import type { WaterRequest } from "./types";

/** True if `request` is still valid to assign to `driverId`. */
export function isAssignableToDriver(
  request: WaterRequest,
  driverId: string,
  now: Date,
): boolean {
  if (request.assignedDriverId) return false;
  if (request.status === "available") return true;
  if (
    request.status === "preferred_driver_hold" &&
    request.preferredDriverId === driverId
  ) {
    if (!request.preferredDriverExpiresAt) return true;
    return new Date(request.preferredDriverExpiresAt) > now;
  }
  return false;
}

export interface SelectNextDispatchCandidateInput {
  /** The driver's currently claimed active delivery, if any. */
  activeDelivery: WaterRequest | null;
  /** Preferred-driver holds addressed to this driver, in canonical
   * dispatch order (see `dispatchQueueCompare`). */
  holds: WaterRequest[];
  /** Available requests in canonical dispatch order (priority bucket,
   * then override rank, then age). */
  available: WaterRequest[];
  /** Request IDs this driver has recently declined/released. */
  declinedRequestIds: Set<string>;
  driverId: string;
  now: Date;
}

/**
 * Pure selection logic for the next request to ASSIGN to a driver.
 *
 * Selection is advisory only — the caller must still claim the selected
 * candidate atomically (`claimWaterRequest`) before showing the driver
 * any details, and must retry with the next candidate if the claim loses
 * a race (see `assignNextDeliveryForDriver` in `dispatch.ts`, issue
 * #123).
 *
 * The caller is responsible for all Firestore reads/writes, ordering,
 * and decline-window policy. This function exists so the selection rules
 * can be unit-tested without a database.
 */
export function selectNextDispatchCandidate(
  input: SelectNextDispatchCandidateInput,
): WaterRequest | null {
  const {
    activeDelivery,
    holds,
    available,
    declinedRequestIds,
    driverId,
    now,
  } = input;

  // One-active-delivery invariant: a driver already servicing a delivery
  // cannot be assigned another until that delivery leaves "claimed"
  // status.
  if (activeDelivery) return null;

  for (const request of holds) {
    if (isAssignableToDriver(request, driverId, now)) {
      return request;
    }
  }

  for (const request of available) {
    if (declinedRequestIds.has(request.id)) continue;
    return request;
  }

  return null;
}
