import type { DriverOffer, WaterRequest } from "./types";

/** True if `request` is still valid to show as an offer to `driverId`. */
export function isOfferableToDriver(
  request: WaterRequest,
  driverId: string,
  now: Date,
): boolean {
  if (request.assignedDriverId) return false;
  if (request.status === "available") return true;
  if (request.status === "preferred_driver_hold" && request.preferredDriverId === driverId) {
    if (!request.preferredDriverExpiresAt) return true;
    return new Date(request.preferredDriverExpiresAt) > now;
  }
  return false;
}

export interface SelectNextDispatchCandidateInput {
  /** An existing pending offer for this driver, if any. */
  pendingOffer: { offer: DriverOffer; request: WaterRequest } | null;
  /** Preferred-driver holds addressed to this driver (already ordered). */
  holds: WaterRequest[];
  /** Available requests (already ordered by priority, then age). */
  available: WaterRequest[];
  /** Request IDs this driver has recently declined. */
  declinedRequestIds: Set<string>;
  driverId: string;
  now: Date;
}

/**
 * Pure selection logic for the next request to offer a driver.
 *
 * The caller is responsible for all Firestore reads/writes, ordering,
 * and decline-window policy. This function exists so the selection rules
 * can be unit-tested without a database.
 */
export function selectNextDispatchCandidate(
  input: SelectNextDispatchCandidateInput,
): WaterRequest | null {
  const { pendingOffer, holds, available, declinedRequestIds, driverId, now } = input;

  if (pendingOffer && isOfferableToDriver(pendingOffer.request, driverId, now)) {
    return pendingOffer.request;
  }

  for (const request of holds) {
    if (isOfferableToDriver(request, driverId, now)) {
      return request;
    }
  }

  for (const request of available) {
    if (declinedRequestIds.has(request.id)) continue;
    return request;
  }

  return null;
}
