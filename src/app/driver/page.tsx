import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getNextOfferForDriver } from "@/lib/domain/dispatch";
import {
  getDriverByLinkedUserId,
  getMeterAssignments,
  reconcileActiveRequestByUserId,
} from "@/lib/domain/driverRegistry";
import { getFillStations } from "@/lib/domain/fillStations";
import type { WaterRequest } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { getClaimedRequestsForDriver } from "@/lib/domain/waterRequests";
import { formatSabaTime } from "@/lib/utils/datetime";

import { AvailabilityToggle } from "./AvailabilityToggle";
import { ClaimedDeliveries } from "./ClaimedDeliveries";
import { OfferCard } from "./OfferCard";

export const metadata: Metadata = {
  title: "Driver — Saba Water Delivery",
};

/** Whether `cooldownUntil` (ISO string) represents an active cooldown as of `now`. */
function isCooldownActive(cooldownUntil: string | null, now: Date): boolean {
  return cooldownUntil !== null && new Date(cooldownUntil).getTime() > now.getTime();
}

/**
 * Resolves display info for the customer on a request. Prefers the
 * request's own customer snapshot (present on all new requests,
 * registered or unregistered) and only falls back to a live profile
 * lookup for legacy requests that predate the snapshot field.
 */
function resolveCustomerInfo(
  request: WaterRequest,
  profileMap: Record<string, { displayName: string; phone: string | null }>,
): { displayName: string; phone: string | null } | null {
  if (request.customer) {
    return { displayName: request.customer.displayName, phone: request.customer.phone };
  }
  if (request.customerId) {
    return profileMap[request.customerId] ?? null;
  }
  return null;
}

export default async function DriverPortalPage() {
  const { uid, profile } = await requireRole("driver");

  // Having the `driver` role only grants access to this portal — it does
  // NOT make someone an operational driver. That requires a government-
  // managed Driver Registry entry explicitly linked to this account (see
  // TECHNICAL.md "Driver Registry"). Nothing is auto-created here.
  const driverEntry = await getDriverByLinkedUserId(uid);

  if (!driverEntry) {
    return (
      <>
        <PortalHeader portalName="Driver" roles={profile.roles} />
        <main className="flex-1 py-8">
          <Container className="flex flex-col gap-6">
            <Card>
              <h1 className="text-2xl font-bold text-slate-900">Driver</h1>
              <p className="mt-2 text-sm text-slate-600">
                Your account is not yet linked to a driver record. Contact
                the water office to be added to the Driver Registry.
              </p>
            </Card>
          </Container>
        </main>
      </>
    );
  }

  // Reconcile stale activeRequestId before rendering — if the driver's
  // lock points to a missing/completed/reassigned request, clear it so
  // the portal does not permanently block the driver.
  await reconcileActiveRequestByUserId(uid);

  const now = new Date();
  const isOnline = driverEntry.availabilityStatus === "online";
  const isEligible = driverEntry.eligibilityStatus === "eligible";
  const inCooldown = isCooldownActive(driverEntry.cooldownUntil, now);
  const cooldownUntil = driverEntry.cooldownUntil
    ? new Date(driverEntry.cooldownUntil)
    : null;
  const canReceiveOffers = isOnline && isEligible && !inCooldown;

  // Fetch the driver's active deliveries first; if they already have one,
  // skip the offer query to avoid an unnecessary read. getNextOfferForDriver
  // still enforces the same rule independently.
  const [claimedDeliveries, fillStations, driverMeters] = await Promise.all([
    getClaimedRequestsForDriver(uid),
    getFillStations(),
    getMeterAssignments(driverEntry.id),
  ]);
  const nextOffer =
    canReceiveOffers && claimedDeliveries.length === 0
      ? await getNextOfferForDriver(uid)
      : null;

  // Fetch customer info for legacy requests only (those without a
  // customer snapshot). Unregistered customers have no `users/{uid}`
  // document and always carry a snapshot, so they never need this.
  const requestsNeedingLookup = [
    ...claimedDeliveries,
    ...(nextOffer ? [nextOffer.request] : []),
  ].filter((r) => !r.customer && r.customerId);
  const legacyCustomerIds = [
    ...new Set(requestsNeedingLookup.map((r) => r.customerId as string)),
  ];
  const customerInfoMap: Record<string, { displayName: string; phone: string | null }> = {};
  await Promise.all(
    legacyCustomerIds.map(async (customerId) => {
      const profile = await getUserProfile(customerId);
      if (profile) {
        customerInfoMap[customerId] = {
          displayName: profile.displayName,
          phone: profile.phone,
        };
      }
    }),
  );

  return (
    <>
      <PortalHeader portalName="Driver" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6">
          {/* Status card */}
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Driver</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {!isEligible && "Your delivery access is pending approval."}
                  {isEligible && inCooldown && "Delivery offers are temporarily paused."}
                  {isEligible && !inCooldown && isOnline && "You are online and receiving offers."}
                  {isEligible && !inCooldown && !isOnline && "You are offline."}
                </p>
              </div>
              {isOnline && !inCooldown && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Online
                </span>
              )}
              {!isOnline && isEligible && !inCooldown && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  Offline
                </span>
              )}
              {isEligible && inCooldown && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                  Paused
                </span>
              )}
              {!isEligible && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
                  Restricted
                </span>
              )}
            </div>

            {/* Toggle (only show if eligible) */}
            {isEligible && (
              <div className="mt-4">
                <AvailabilityToggle currentStatus={isOnline ? "online" : "offline"} />
              </div>
            )}

            {/* Ineligible warning */}
            {!isEligible && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-800">
                  Your delivery access has been restricted. You cannot claim new
                  requests. Contact the water office if you have questions.
                </p>
              </div>
            )}

            {/* Cooldown notice */}
            {isEligible && inCooldown && cooldownUntil && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">
                  Delivery offers paused
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  You reached today&apos;s decline limit. You can receive new
                  offers again at {formatSabaTime(cooldownUntil)}.
                </p>
              </div>
            )}
          </Card>

          {/* Claimed deliveries (always shown if any exist) */}
          <ClaimedDeliveries
            deliveries={claimedDeliveries}
            customerInfo={customerInfoMap}
            stations={fillStations}
            meters={driverMeters}
          />

          {/* Current dispatch offer (only when eligible, online, and not in cooldown) */}
          {canReceiveOffers && nextOffer && (
            <OfferCard
              key={nextOffer.offer.id}
              offer={nextOffer.offer}
              request={nextOffer.request}
              customer={resolveCustomerInfo(nextOffer.request, customerInfoMap)}
              driverId={uid}
            />
          )}

          {canReceiveOffers && !nextOffer && claimedDeliveries.length > 0 && (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">Next Delivery</h2>
              <p className="mt-2 text-sm text-slate-600">
                Complete your current delivery to receive the next request.
              </p>
            </Card>
          )}

          {canReceiveOffers && !nextOffer && claimedDeliveries.length === 0 && (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">Next Delivery</h2>
              <p className="mt-2 text-sm text-slate-600">
                No deliveries available right now.
              </p>
            </Card>
          )}

          {isEligible && !isOnline && !inCooldown && (
            <Card>
              <p className="text-sm text-slate-600">
                You are offline. Go online to receive delivery offers.
              </p>
            </Card>
          )}
        </Container>
      </main>
    </>
  );
}
