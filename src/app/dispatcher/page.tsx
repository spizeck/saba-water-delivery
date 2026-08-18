import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDrivers } from "@/lib/domain/drivers";
import { getUserProfile } from "@/lib/domain/users";
import { getAllRequests } from "@/lib/domain/waterRequests";
import type { WaterRequestStatus } from "@/lib/domain/types";

import { DriverList } from "./DriverList";
import { RequestList } from "./RequestList";

export const metadata: Metadata = {
  title: "Dispatcher — Saba Water Delivery",
};

/** Priority ordering for the operational queue. Lower = higher priority. */
const STATUS_PRIORITY: Record<WaterRequestStatus, number> = {
  disputed: 0,
  delivered_unconfirmed: 1,
  delivered: 2,
  available: 3,
  preferred_driver_hold: 4,
  claimed: 5,
  requested: 6,
  confirmed: 7,
  cancelled: 8,
};

export default async function DispatcherPortalPage() {
  const { profile } = await requireRole(["dispatcher", "admin"]);

  const [allRequests, allDrivers] = await Promise.all([
    getAllRequests(),
    getAllDrivers(),
  ]);

  // Sort by priority, then by requestedAt (oldest first within priority).
  const sortedRequests = [...allRequests].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99;
    const pb = STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
  });

  // Resolve customer names for display.
  const customerIds = [...new Set(sortedRequests.map((r) => r.customerId))];
  const customerNames: Record<string, string> = {};
  await Promise.all(
    customerIds.map(async (id) => {
      const p = await getUserProfile(id);
      if (p) customerNames[id] = p.displayName;
    }),
  );

  // Resolve driver names for display.
  const driverIds = [
    ...new Set([
      ...sortedRequests.map((r) => r.assignedDriverId).filter(Boolean),
      ...sortedRequests.map((r) => r.preferredDriverId).filter(Boolean),
    ]),
  ] as string[];
  const driverNames: Record<string, string> = {};
  for (const d of allDrivers) {
    driverNames[d.uid] = d.displayName;
  }
  // Also fetch any driver names not in the driver list.
  await Promise.all(
    driverIds
      .filter((id) => !driverNames[id])
      .map(async (id) => {
        const p = await getUserProfile(id);
        if (p) driverNames[id] = p.displayName;
      }),
  );

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-8 max-w-5xl">
          <RequestList
            requests={sortedRequests}
            customerNames={customerNames}
            driverNames={driverNames}
          />
          <DriverList drivers={allDrivers} />
        </Container>
      </main>
    </>
  );
}
