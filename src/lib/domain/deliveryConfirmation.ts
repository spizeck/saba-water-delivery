/**
 * Pure delivery-confirmation timing logic, kept separate from
 * `waterRequests.ts` (which requires `server-only`/Firebase Admin) so it
 * can be unit tested directly and reused anywhere the confirmation
 * deadline needs to be evaluated without a Firestore round trip (e.g.
 * statistics aggregation).
 *
 * See PRODUCT.md "Delivery Confirmation" and TECHNICAL.md "Delivery
 * Confirmation Timeout" for the product/implementation rationale:
 * customer confirmation is independent of driver availability, and a
 * delivery that receives no resident response within the configured
 * window is automatically confirmed (never left in a separate
 * "unconfirmed" status).
 */

import { appConfig } from "./config";

/**
 * The instant a "delivered" request's confirmation window closes, given
 * when it was delivered. Defaults to the centralized
 * `appConfig.deliveryConfirmationWindowHours`.
 */
export function confirmationDeadline(
  deliveredAt: Date,
  windowHours: number = appConfig.deliveryConfirmationWindowHours,
): Date {
  return new Date(deliveredAt.getTime() + windowHours * 60 * 60 * 1000);
}

/**
 * Whether a "delivered" request's confirmation window has expired as of
 * `now` (defaults to the current time). Once true and no resident
 * response has been recorded, the request should be auto-confirmed —
 * see `checkDeliveryConfirmationTimeout()` in `waterRequests.ts`.
 */
export function isConfirmationWindowExpired(
  deliveredAt: Date,
  now: Date = new Date(),
  windowHours: number = appConfig.deliveryConfirmationWindowHours,
): boolean {
  return now.getTime() >= confirmationDeadline(deliveredAt, windowHours).getTime();
}
