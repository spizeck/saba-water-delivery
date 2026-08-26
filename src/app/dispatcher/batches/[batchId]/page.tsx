import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getDispatchBatch } from "@/lib/domain/dispatchBatches";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { priorityRankFor } from "@/lib/domain/priority";
import type { DispatchPriority, WaterRequestStatus } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { getRequestsForDispatchBatch } from "@/lib/domain/waterRequests";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { RecordBatchDeliveryButton } from "./RecordBatchDeliveryButton";

export const metadata: Metadata = {
  title: "Batch Detail — Dispatcher",
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

export default async function BatchDetailPage({ params }: PageProps) {
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
              <p className="text-slate-600">Batch not found.</p>
              <Link href="/dispatcher/batches" className="mt-2 inline-block text-blue-700 hover:underline text-sm">
                Back to Batch Dispatch
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
  const driverName = driverNames[batch.driverId] ?? "Unknown driver";
  const createdByName = createdByProfile?.displayName ?? batch.createdBy ?? "Unknown";

  const sortedRequests = [...requests].sort((a, b) => {
    const seqDiff = (a.batchSequence ?? 0) - (b.batchSequence ?? 0);
    if (seqDiff !== 0) return seqDiff;
    const rankDiff = priorityRankFor(a.dispatchPriority) - priorityRankFor(b.dispatchPriority);
    if (rankDiff !== 0) return rankDiff;
    return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
  });

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div>
            <Link href="/dispatcher/batches" className="text-blue-700 hover:underline text-sm">
              &larr; Back to Batch Dispatch
            </Link>
          </div>

          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Batch for {driverName}</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Created {formatSabaDateTime(batch.createdAt)} by {createdByName}
                </p>
                <p className="text-xs text-slate-400">Batch ID: {batch.id}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {batch.originalRequestIds.length} load
                  {batch.originalRequestIds.length === 1 ? "" : "s"} originally assigned
                  {batch.generatedAt && (
                    <> &middot; Sheet last generated {formatSabaDateTime(batch.generatedAt)}</>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    batch.status === "active" ? "bg-indigo-50 text-indigo-800" : "bg-green-50 text-green-700"
                  }`}
                >
                  {batch.status === "active" ? "Active" : "Completed"}
                </span>
                <a
                  href={`/api/dispatcher/batches/${batch.id}/pdf`}
                  className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {batch.generatedAt ? "Reprint Dispatch Sheet" : "Download Dispatch Sheet"}
                </a>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">
              Loads ({sortedRequests.length}
              {sortedRequests.length !== batch.originalRequestIds.length && (
                <span className="font-normal text-slate-500">
                  {" "}
                  of {batch.originalRequestIds.length} originally assigned — the rest were
                  reassigned or cancelled out of this batch
                </span>
              )}
              )
            </h2>
            {sortedRequests.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No requests currently belong to this batch.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {sortedRequests.map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">
                          {r.batchSequence ?? "—"}.{" "}
                          <Link href={`/dispatcher/${r.id}`} className="hover:underline">
                            {r.customer?.displayName ?? "Unknown"}
                          </Link>
                        </p>
                        <p className="text-sm text-slate-700">
                          {r.village} &middot; {r.customer?.phone ?? "No phone"} &middot; {r.gallons} gal
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{r.deliveryDirections}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                              PRIORITY_COLORS[r.dispatchPriority]
                            }`}
                          >
                            {PRIORITY_LABELS[r.dispatchPriority]} priority
                          </span>
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                            Requested {formatSabaDateTime(r.requestedAt)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[r.status]}`}
                      >
                        {STATUS_LABELS[r.status]}
                      </span>
                    </div>
                    {r.status === "claimed" && (
                      <div className="mt-3">
                        <RecordBatchDeliveryButton requestId={r.id} batchId={batch.id} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Container>
      </main>
    </>
  );
}
