import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { sortForBatchSelection } from "@/lib/domain/dispatchBatchSelection";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { getBatchEligibleRequests } from "@/lib/domain/waterRequests";

import { NewBatchForm } from "./NewBatchForm";

export const metadata: Metadata = {
  title: "New Delivery Run — Dispatcher",
};

export default async function NewDeliveryRunPage() {
  const { profile } = await requireRole(["dispatcher", "admin"]);

  const [allDrivers, eligibleRequests] = await Promise.all([
    getAllDriverRegistryEntries(),
    getBatchEligibleRequests(),
  ]);

  // Only eligible, account-linked drivers can be selected — see
  // PRODUCT.md "Batch Dispatch". Online/offline and cooldown are shown
  // to the dispatcher rather than filtered out, since a deliberate
  // batch assignment does not require the driver to be online (the
  // whole point may be preparing a printed run sheet for a driver whose
  // phone/data access is unreliable) — see TECHNICAL.md "Batch
  // Dispatch".
  const now = new Date();
  const driverOptions = allDrivers
    .filter((d) => d.eligibilityStatus === "eligible" && d.linkedUserId)
    .map((d) => ({
      uid: d.linkedUserId as string,
      displayName: d.displayName,
      availabilityStatus: d.availabilityStatus,
      inCooldown: Boolean(d.cooldownUntil && new Date(d.cooldownUntil) > now),
      hasActiveDelivery: Boolean(d.activeRequestId),
    }));

  const driverNames: Record<string, string> = {};
  for (const d of allDrivers) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
  }

  const sortedRequests = sortForBatchSelection(eligibleRequests).map((r) => ({
    id: r.id,
    customerName: r.customer?.displayName || "Unknown",
    village: r.village,
    loads: r.loads,
    priority: r.dispatchPriority,
    requestedAt: r.requestedAt,
    preferredDriverId: r.preferredDriverId,
    preferredDriverName: r.preferredDriverId ? (driverNames[r.preferredDriverId] ?? "Unknown driver") : null,
  }));

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-3xl">
          <div>
            <Link href="/dispatcher/batches" className="text-blue-700 hover:underline text-sm">
              &larr; Back to Delivery Runs
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">New Delivery Run</h1>
            <p className="mt-1 text-sm text-slate-600">
              Select a driver, then choose the requests to assign them at once.
            </p>
          </div>

          {driverOptions.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-600">
                No eligible, account-linked drivers are available. A driver
                must be entered in the Driver Registry, have signed in and
                been linked to their account, and be marked eligible before
                they can receive a delivery run.
              </p>
            </Card>
          ) : sortedRequests.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-600">
                There are no outstanding requests eligible for a delivery run
                right now.
              </p>
            </Card>
          ) : (
            <NewBatchForm drivers={driverOptions} requests={sortedRequests} />
          )}
        </Container>
      </main>
    </>
  );
}
