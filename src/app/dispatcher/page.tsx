import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { isConfirmationWindowExpired } from "@/lib/domain/deliveryConfirmation";
import { getActiveDriverRegistryEntries, reconcileActiveRequest } from "@/lib/domain/driverRegistry";
import { priorityRankFor } from "@/lib/domain/priority";
import type { WaterRequestStatus } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { checkDeliveryConfirmationTimeout, getAllRequests } from "@/lib/domain/waterRequests";

import { DriverList, type DriverWorkload } from "./DriverList";
import { RequestList } from "./RequestList";
import { SendContinuityReportButton } from "./SendContinuityReportButton";

export const metadata: Metadata = {
  title: "Dispatcher — Saba Water Delivery",
};

/** Priority ordering for the operational queue. Lower = higher priority. */
const STATUS_PRIORITY: Record<WaterRequestStatus, number> = {
  disputed: 0,
  delivered: 1,
  available: 2,
  preferred_driver_hold: 3,
  claimed: 4,
  requested: 5,
  confirmed: 6,
  cancelled: 7,
};

export default async function DispatcherPortalPage() {
  const { profile } = await requireRole(["dispatcher", "admin"]);

  const [initialRequests, allDrivers] = await Promise.all([
    getAllRequests(),
    getActiveDriverRegistryEntries(),
  ]);

  // Lazily auto-confirm any "delivered" request whose confirmation
  // window has already expired, so the dashboard never keeps showing a
  // stale "delivered" request that should have resolved on its own —
  // see PRODUCT.md "Delivery Confirmation".
  const expiredDeliveredIds = initialRequests
    .filter(
      (r) =>
        r.status === "delivered" &&
        r.deliveredAt &&
        isConfirmationWindowExpired(new Date(r.deliveredAt)),
    )
    .map((r) => r.id);
  if (expiredDeliveredIds.length > 0) {
    await Promise.all(expiredDeliveredIds.map((id) => checkDeliveryConfirmationTimeout(id)));
  }
  const allRequests = expiredDeliveredIds.length > 0 ? await getAllRequests() : initialRequests;

  // Sort by operational status group first (disputes/unconfirmed need
  // staff attention regardless of dispatch priority), then by dispatch
  // priority (critical, then urgent, then normal — see PRODUCT.md
  // "Priority-Based Dispatch"), then oldest request first within that.
  const sortedRequests = [...allRequests].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99;
    const pb = STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    const priorityDiff = priorityRankFor(a.dispatchPriority) - priorityRankFor(b.dispatchPriority);
    if (priorityDiff !== 0) return priorityDiff;
    const overrideA = a.dispatchOverrideRank ?? Infinity;
    const overrideB = b.dispatchOverrideRank ?? Infinity;
    if (overrideA !== overrideB) return overrideA - overrideB;
    return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
  });

  // Resolve customer display names, keyed by REQUEST id (not customer id —
  // unregistered/manual requests all share customerId === null, so a
  // customerId-keyed map would collide across different customers).
  // Prefer the request's own customer snapshot; only fall back to a live
  // profile lookup for legacy requests that predate the snapshot field.
  const customerNames: Record<string, string> = {};
  const legacyCustomerIds = [
    ...new Set(
      sortedRequests
        .filter((r) => !r.customer && r.customerId)
        .map((r) => r.customerId as string),
    ),
  ];
  const legacyProfiles: Record<string, string> = {};
  await Promise.all(
    legacyCustomerIds.map(async (id) => {
      const p = await getUserProfile(id);
      if (p) legacyProfiles[id] = p.displayName;
    }),
  );
  for (const r of sortedRequests) {
    if (r.customer) {
      customerNames[r.id] = r.customer.displayName;
    } else if (r.customerId) {
      customerNames[r.id] = legacyProfiles[r.customerId] ?? "Unknown";
    } else {
      customerNames[r.id] = "Unknown";
    }
  }

  // Resolve driver names for display.
  const driverIds = [
    ...new Set([
      ...sortedRequests.map((r) => r.assignedDriverId).filter(Boolean),
      ...sortedRequests.map((r) => r.preferredDriverId).filter(Boolean),
    ]),
  ] as string[];
  const driverNames: Record<string, string> = {};
  for (const d of allDrivers) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
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

  // Build per-driver workload summaries from claimed requests.
  const driverWorkloads: Record<string, DriverWorkload> = {};
  // Map from linkedUserId -> registryId for driver lookup.
  const uidToRegistryId = new Map<string, string>();
  for (const d of allDrivers) {
    if (d.linkedUserId) uidToRegistryId.set(d.linkedUserId, d.id);
  }
  for (const req of allRequests) {
    if (req.status !== "claimed" || !req.assignedDriverId) continue;
    const registryId = uidToRegistryId.get(req.assignedDriverId);
    if (!registryId) continue;
    if (!driverWorkloads[registryId]) {
      driverWorkloads[registryId] = { openRequests: 0, openLoads: 0, requests: [] };
    }
    const wl = driverWorkloads[registryId];
    wl.openRequests += 1;
    wl.openLoads += req.loads;
    wl.requests.push({
      requestId: req.id,
      customerName: customerNames[req.id] ?? "Unknown",
      village: req.village,
      loads: req.loads,
      loadsCollected: req.loadCollections?.length ?? 0,
      isBatchAssigned: Boolean(req.dispatchBatchId),
      isEscalated: req.dispatchOverrideRank != null,
    });
  }

  // Reconcile any driver with a stale activeRequestId but no real open
  // workload. This prevents the "0 open requests but blocked" state.
  await Promise.all(
    allDrivers
      .filter((d) => d.activeRequestId && !driverWorkloads[d.id]?.openRequests)
      .map((d) => reconcileActiveRequest(d.id)),
  );

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-8 max-w-5xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/dispatcher/new"
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                + Create Water Request
              </Link>
              <Link
                href="/dispatcher/batches/new"
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100"
              >
                New Delivery Run
              </Link>
              <Link
                href="/dispatcher/batches"
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100"
              >
                Delivery Runs
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/api/reports/continuity-snapshot"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Generate Continuity Report
              </a>
              <SendContinuityReportButton />
              <Link
                href="/statistics"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View Statistics
              </Link>
            </div>
          </div>
          <RequestList
            requests={sortedRequests}
            customerNames={customerNames}
            driverNames={driverNames}
          />
          <DriverList drivers={allDrivers} workloads={driverWorkloads} />
        </Container>
      </main>
    </>
  );
}
