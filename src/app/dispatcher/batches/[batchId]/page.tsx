import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getDispatchBatch } from "@/lib/domain/dispatchBatches";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import type { DispatchPriority, WaterRequest, WaterRequestStatus } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { getRequestsForDispatchBatch } from "@/lib/domain/waterRequests";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { CloseRunButton } from "./CloseRunButton";
import { RecordBatchDeliveryButton } from "./RecordBatchDeliveryButton";

export const metadata: Metadata = {
  title: "Delivery Run — Dispatcher",
};

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Preferred driver hold",
  available: "Available",
  claimed: "Not yet delivered",
  delivered: "Delivered — awaiting confirmation",
  confirmed: "Delivered — confirmed",
  disputed: "Delivered — disputed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<WaterRequestStatus, string> = {
  requested: "bg-blue-50 text-blue-800",
  preferred_driver_hold: "bg-amber-50 text-amber-800",
  available: "bg-blue-50 text-blue-800",
  claimed: "bg-indigo-50 text-indigo-800",
  delivered: "bg-green-50 text-green-800",
  confirmed: "bg-green-50 text-green-700",
  disputed: "bg-red-100 text-red-900",
  cancelled: "bg-slate-100 text-slate-500",
};

const PRIORITY_LABELS: Record<DispatchPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
};

const PRIORITY_COLORS: Record<DispatchPriority, string> = {
  normal: "bg-slate-100 text-slate-600",
  urgent: "bg-amber-50 text-amber-800",
  critical: "bg-red-100 text-red-900",
};

interface PageProps {
  params: Promise<{ batchId: string }>;
}

export default async function DeliveryRunDetailPage({ params }: PageProps) {
  const { profile } = await requireRole(["dispatcher", "admin"]);
  const { batchId } = await params;

  const batch = await getDispatchBatch(batchId);
  if (!batch) {
    return (
      <>
        <PortalHeader portalName="Dispatcher" roles={profile.roles} />
        <main className="flex-1 py-8">
          <Container>
            <Card>
              <p className="text-slate-600">Delivery run not found.</p>
              <Link href="/dispatcher/batches" className="mt-2 inline-block text-blue-700 hover:underline text-sm">
                Back to Delivery Runs
              </Link>
            </Card>
          </Container>
        </main>
      </>
    );
  }

  const [requests, allDrivers, createdByProfile] = await Promise.all([
    getRequestsForDispatchBatch(batchId),
    getAllDriverRegistryEntries(),
    batch.createdBy ? getUserProfile(batch.createdBy) : null,
  ]);

  const driverNames: Record<string, string> = {};
  for (const d of allDrivers) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
  }
  const driverName = batch.driverDisplayName || driverNames[batch.driverId] || "Unknown driver";
  const createdByName = createdByProfile?.displayName ?? batch.createdBy ?? "Unknown";

  const sortedRequests = [...requests].sort((a, b) => {
    const seqDiff = (a.batchSequence ?? 0) - (b.batchSequence ?? 0);
    if (seqDiff !== 0) return seqDiff;
    return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
  });

  // Compute progress.
  const totalLoads = sortedRequests.reduce((sum, r) => sum + r.loads, 0);
  const claimedRequests = sortedRequests.filter((r) => r.status === "claimed");
  const deliveredLoads = sortedRequests
    .filter((r) => ["delivered", "confirmed", "disputed"].includes(r.status))
    .reduce((sum, r) => sum + r.loads, 0);
  const allPhysicallyDelivered = claimedRequests.length === 0 && sortedRequests.length > 0;

  // Run state label.
  let runStateLabel: string;
  let runStateColor: string;
  if (sortedRequests.length === 0) {
    runStateLabel = "No requests remaining";
    runStateColor = "bg-slate-100 text-slate-500";
  } else if (claimedRequests.length > 0) {
    runStateLabel = "In Progress";
    runStateColor = "bg-indigo-50 text-indigo-800";
  } else if (sortedRequests.some((r) => r.status === "delivered")) {
    runStateLabel = "Awaiting Confirmation";
    runStateColor = "bg-amber-50 text-amber-800";
  } else {
    runStateLabel = "Completed";
    runStateColor = "bg-green-50 text-green-700";
  }

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div>
            <Link href="/dispatcher/batches" className="text-blue-700 hover:underline text-sm">
              &larr; Back to Delivery Runs
            </Link>
          </div>

          {/* Run header */}
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Delivery Run — {driverName}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Created {formatSabaDateTime(batch.createdAt)} by {createdByName}
                </p>
                {batch.originalRequestIds.length !== sortedRequests.length && (
                  <p className="text-xs text-slate-400">
                    {batch.originalRequestIds.length} originally assigned
                    {sortedRequests.length < batch.originalRequestIds.length &&
                      ` — ${batch.originalRequestIds.length - sortedRequests.length} reassigned or cancelled`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${runStateColor}`}>
                  {runStateLabel}
                </span>
                <a
                  href={`/api/dispatcher/batches/${batch.id}/pdf`}
                  className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {batch.generatedAt ? "Reprint Run Sheet" : "Print Run Sheet"}
                </a>
                {batch.status === "active" && claimedRequests.length === 0 && (
                  <CloseRunButton batchId={batch.id} />
                )}
              </div>
            </div>

            {/* Progress summary */}
            {sortedRequests.length > 0 && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="text-slate-700">
                    <span className="font-semibold">{sortedRequests.length}</span>{" "}
                    request{sortedRequests.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-slate-700">
                    <span className="font-semibold">{totalLoads}</span>{" "}
                    load{totalLoads !== 1 ? "s" : ""}
                  </span>
                  <span className={allPhysicallyDelivered ? "font-semibold text-green-700" : "text-slate-700"}>
                    {deliveredLoads} of {totalLoads} delivered
                  </span>
                </div>
                {totalLoads > 0 && !allPhysicallyDelivered && (
                  <div className="mt-2 h-2 w-full rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all"
                      style={{ width: `${Math.round((deliveredLoads / totalLoads) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Requests */}
          <Card>
            <h2 className="text-lg font-bold text-slate-900">
              Deliveries ({sortedRequests.length})
            </h2>
            {sortedRequests.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No requests currently belong to this delivery run.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {sortedRequests.map((r) => (
                  <RequestRow key={r.id} request={r} batchId={batch.id} />
                ))}
              </div>
            )}
          </Card>
        </Container>
      </main>
    </>
  );
}

function RequestRow({ request: r, batchId }: { request: WaterRequest; batchId: string }) {
  const collectedLoads = r.loadCollections?.length ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {r.batchSequence ?? "—"}.{" "}
            <Link href={`/dispatcher/${r.id}`} className="hover:underline text-blue-700">
              {r.customer?.displayName ?? "Unknown"}
            </Link>
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-600">
            <span>{r.village}</span>
            <span>{r.customer?.phone ?? "No phone"}</span>
            <span>{formatWaterQuantity(r.loads)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{r.deliveryDirections}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${PRIORITY_COLORS[r.dispatchPriority]}`}>
              {PRIORITY_LABELS[r.dispatchPriority]}
            </span>
            {r.dispatchOverrideRank != null && (
              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                Escalated
              </span>
            )}
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
              Requested {formatSabaDateTime(r.requestedAt)}
            </span>
          </div>
          {r.status === "claimed" && (
            <p className="mt-1.5 text-xs text-slate-600">
              Water collected: {collectedLoads}/{r.loads} load{r.loads !== 1 ? "s" : ""}
              {r.loadCollections && r.loadCollections.length > 0 && (
                <span className="ml-2 text-slate-400">
                  ({r.loadCollections.map((c) =>
                    `${c.fillStationName} — Meter ${c.meterNumber}`
                  ).join("; ")})
                </span>
              )}
            </p>
          )}
        </div>
        <span className={`inline-flex shrink-0 self-start rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[r.status]}`}>
          {STATUS_LABELS[r.status]}
        </span>
      </div>
      {r.status === "claimed" && (
        <div className="mt-3">
          <RecordBatchDeliveryButton requestId={r.id} batchId={batchId} />
        </div>
      )}
    </div>
  );
}
