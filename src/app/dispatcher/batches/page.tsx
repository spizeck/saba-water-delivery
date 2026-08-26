import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDispatchBatches } from "@/lib/domain/dispatchBatches";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { formatSabaDateTime } from "@/lib/utils/datetime";

export const metadata: Metadata = {
  title: "Batch Dispatch — Saba Water Delivery",
};

export default async function DispatchBatchesPage() {
  const { profile } = await requireRole(["dispatcher", "admin"]);

  const [batches, drivers] = await Promise.all([
    getAllDispatchBatches(),
    getAllDriverRegistryEntries(),
  ]);

  const driverNames: Record<string, string> = {};
  for (const d of drivers) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
  }

  const active = batches.filter((b) => b.status === "active");
  const completed = batches.filter((b) => b.status !== "active");

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Link href="/dispatcher" className="text-blue-700 hover:underline text-sm">
                &larr; Back to dashboard
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">Batch Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">
                Assign several outstanding requests to one driver at once and
                print a driver dispatch sheet. Use this for planned runs or
                for a driver whose phone/data access is unreliable — it does
                not replace the normal one-offer-at-a-time driver dispatch.
              </p>
            </div>
            <Link
              href="/dispatcher/batches/new"
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              + New Batch
            </Link>
          </div>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">Active batches ({active.length})</h2>
            {active.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No active batches.</p>
            ) : (
              <BatchTable batches={active} driverNames={driverNames} />
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">
              Completed batches ({completed.length})
            </h2>
            {completed.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No completed batches yet.</p>
            ) : (
              <BatchTable batches={completed} driverNames={driverNames} />
            )}
          </Card>
        </Container>
      </main>
    </>
  );
}

function BatchTable({
  batches,
  driverNames,
}: {
  batches: Awaited<ReturnType<typeof getAllDispatchBatches>>;
  driverNames: Record<string, string>;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {batches.map((batch) => (
        <Link
          key={batch.id}
          href={`/dispatcher/batches/${batch.id}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
        >
          <div>
            <p className="text-sm font-medium text-slate-900">
              {driverNames[batch.driverId] ?? "Unknown driver"}
            </p>
            <p className="text-xs text-slate-500">
              {batch.originalRequestIds.length} request
              {batch.originalRequestIds.length === 1 ? "" : "s"} &middot; Created{" "}
              {formatSabaDateTime(batch.createdAt)}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              batch.status === "active"
                ? "bg-indigo-50 text-indigo-800"
                : "bg-green-50 text-green-700"
            }`}
          >
            {batch.status === "active" ? "Active" : "Completed"}
          </span>
        </Link>
      ))}
    </div>
  );
}
