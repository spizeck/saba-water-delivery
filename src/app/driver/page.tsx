import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { assignNextDeliveryForDriver } from "@/lib/domain/dispatch";
import {
  getDriverByLinkedUserId,
  getMeterAssignments,
  reconcileActiveRequestByUserId,
} from "@/lib/domain/driverRegistry";
import { getFillStations } from "@/lib/domain/fillStations";
import { getUserProfile } from "@/lib/domain/users";
import { getClaimedRequestsForDriver } from "@/lib/domain/waterRequests";
import {
  formatSabaDate,
  formatSabaTime,
  startOfSabaDay,
} from "@/lib/utils/datetime";

import { AvailabilityToggle } from "./AvailabilityToggle";
import { ClaimedDeliveries } from "./ClaimedDeliveries";

export const metadata: Metadata = {
  title: "Driver — Saba Water Delivery",
};

/** Whether `cooldownUntil` (ISO string) represents an active cooldown as of `now`. */
function isCooldownActive(cooldownUntil: string | null, now: Date): boolean {
  return (
    cooldownUntil !== null && new Date(cooldownUntil).getTime() > now.getTime()
  );
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
                Your account is not yet linked to a driver record. Contact the
                water office to be added to the Driver Registry.
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
  const endOfToday = startOfSabaDay(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );
  const isDailyCooldown =
    cooldownUntil !== null && cooldownUntil.getTime() >= endOfToday.getTime();
  const canReceiveAssignments = isOnline && isEligible && !inCooldown;

  // Assignment-on-visibility (issue #123): for an eligible, online driver
  // the next delivery is CLAIMED atomically before anything renders — the
  // request stops being dispatchable the moment its details can reach the
  // page. `assignNextDeliveryForDriver` is idempotent (an existing
  // assignment is returned unchanged) and re-checks eligibility, online
  // state, cooldown, and the active-delivery lock transactionally.
  const [claimedDeliveries, fillStations, driverMeters] = await Promise.all([
    getClaimedRequestsForDriver(uid),
    getFillStations(),
    getMeterAssignments(driverEntry.id),
  ]);
  const deliveries = [...claimedDeliveries];
  if (canReceiveAssignments && deliveries.length === 0) {
    const assigned = await assignNextDeliveryForDriver(uid);
    if (assigned) deliveries.push(assigned);
  }

  // Fetch customer info for legacy requests only (those without a
  // customer snapshot). Unregistered customers have no `users/{uid}`
  // document and always carry a snapshot, so they never need this.
  const requestsNeedingLookup = deliveries.filter(
    (r) => !r.customer && r.customerId,
  );
  const legacyCustomerIds = [
    ...new Set(requestsNeedingLookup.map((r) => r.customerId as string)),
  ];
  const customerInfoMap: Record<
    string,
    { displayName: string; phone: string | null }
  > = {};
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
                  {!isEligible && "Your delivery access is restricted."}
                  {isEligible &&
                    inCooldown &&
                    isDailyCooldown &&
                    "You are offline for the rest of today."}
                  {isEligible &&
                    inCooldown &&
                    !isDailyCooldown &&
                    cooldownUntil &&
                    `You are offline until ${formatSabaTime(cooldownUntil)}.`}
                  {isEligible &&
                    !inCooldown &&
                    isOnline &&
                    "You are online. The next delivery may be assigned to you immediately."}
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
                  {isDailyCooldown
                    ? "Daily limit reached"
                    : "Offline until " +
                      (cooldownUntil ? formatSabaTime(cooldownUntil) : "later")}
                </span>
              )}
              {!isEligible && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
                  Restricted
                </span>
              )}
            </div>

            {/* Toggle (only show if eligible and not in an enforced cooldown) */}
            {isEligible && !inCooldown && (
              <div className="mt-4">
                <AvailabilityToggle
                  currentStatus={isOnline ? "online" : "offline"}
                />
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
                  {isDailyCooldown
                    ? "Daily decline limit reached"
                    : "Decline cooldown"}
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  {isDailyCooldown
                    ? `You have reached today’s decline limit and are offline for the rest of the day. You can receive deliveries again on ${formatSabaDate(cooldownUntil)}.`
                    : `You have reached the decline limit. You are offline until ${formatSabaTime(cooldownUntil)}.`}
                </p>
              </div>
            )}
          </Card>

          {/* Assigned deliveries (always shown if any exist) */}
          <ClaimedDeliveries
            deliveries={deliveries}
            customerInfo={customerInfoMap}
            stations={fillStations}
            meters={driverMeters}
          />

          {canReceiveAssignments && deliveries.length > 0 && (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">
                Next Delivery
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Complete your current delivery to receive the next request.
              </p>
            </Card>
          )}

          {canReceiveAssignments && deliveries.length === 0 && (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">
                Next Delivery
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                No deliveries available right now.
              </p>
            </Card>
          )}

          {isEligible && !isOnline && !inCooldown && (
            <Card>
              <p className="text-sm text-slate-600">
                You are offline. Go online to receive a delivery assignment.
              </p>
            </Card>
          )}
        </Container>
      </main>
    </>
  );
}
