import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { ensureDriverProfile } from "@/lib/domain/drivers";
import { getUserProfile } from "@/lib/domain/users";
import {
  getClaimableRequestsForDriver,
  getClaimedRequestsForDriver,
} from "@/lib/domain/waterRequests";

import { AvailabilityToggle } from "./AvailabilityToggle";
import { ClaimedDeliveries } from "./ClaimedDeliveries";
import { RequestQueue } from "./RequestQueue";

export const metadata: Metadata = {
  title: "Driver — Saba Water Delivery",
};

export default async function DriverPortalPage() {
  const { uid } = await requireRole("driver");

  // Ensure driver document exists (new drivers are ineligible by default).
  const driverProfile = await ensureDriverProfile(uid);

  const isOnline = driverProfile.availabilityStatus === "online";
  const isEligible = driverProfile.eligibilityStatus === "eligible";

  // Fetch queue and active deliveries (only if online and eligible).
  const [claimableRequests, claimedDeliveries] = await Promise.all([
    isOnline && isEligible ? getClaimableRequestsForDriver(uid) : [],
    getClaimedRequestsForDriver(uid),
  ]);

  // Fetch customer info for claimed deliveries.
  const customerIds = [...new Set(claimedDeliveries.map((d) => d.customerId))];
  const customerInfoMap: Record<string, { displayName: string; phone: string | null }> = {};
  await Promise.all(
    customerIds.map(async (customerId) => {
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
      <PortalHeader portalName="Driver" />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6">
          {/* Status card */}
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Driver</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {!isEligible && "Your delivery access is pending approval."}
                  {isEligible && isOnline && "You are online and receiving requests."}
                  {isEligible && !isOnline && "You are offline."}
                </p>
              </div>
              {isOnline && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Online
                </span>
              )}
              {!isOnline && isEligible && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  Offline
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
          </Card>

          {/* Claimed deliveries (always shown if any exist) */}
          <ClaimedDeliveries
            deliveries={claimedDeliveries}
            customerInfo={customerInfoMap}
          />

          {/* Request queue (only when online and eligible) */}
          {isOnline && isEligible && (
            <RequestQueue requests={claimableRequests} driverId={uid} />
          )}
        </Container>
      </main>
    </>
  );
}
