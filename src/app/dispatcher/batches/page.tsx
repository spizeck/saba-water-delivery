import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import {
  getAllDispatchBatchSummaries,
  type DispatchBatchSummary,
} from "@/lib/domain/dispatchBatches";
import { getActiveDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import { formatSabaDateTime } from "@/lib/utils/datetime";

export const metadata: Metadata = {
  title: "Delivery Runs — Saba Water Delivery",
};

const STATE_LABELS: Record<DispatchBatchSummary["derivedState"], string> = {
  in_progress: "In Progress",
  all_delivered: "Awaiting Confirmation",
  completed: "Completed",
};

const STATE_COLORS: Record<DispatchBatchSummary["derivedState"], string> = {
  in_progress: "bg-indigo-50 text-indigo-800",
  all_delivered: "bg-amber-50 text-amber-800",
  completed: "bg-green-50 text-green-700",
};

export default async function DeliveryRunsPage() {
  const { profile } = await requireRole(["dispatcher", "admin"]);

  const drivers = await getActiveDriverRegistryEntries();
  const driverNames: Record<string, string> = {};
  for (const d of drivers) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
  }

  const summaries = await getAllDispatchBatchSummaries(driverNames);
  const active = summaries.filter((s) => s.derivedState !== "completed");
  const completed = summaries.filter((s) => s.derivedState === "completed");

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href="/dispatcher" className="text-blue-700 hover:underline text-sm">
                &larr; Back to dashboard
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">Delivery Runs</h1>
              <p className="mt-1 text-sm text-slate-600">
                Create a delivery run when you want to assign several deliveries
                to one driver at once. The driver can use the app, or you can
                print a run sheet for them.
              </p>
            </div>
            <Link
              href="/dispatcher/batches/new"
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              + New Delivery Run
            </Link>
          </div>

          <section>
            <h2 className="text-lg font-bold text-slate-900">
              Active Delivery Runs ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No active delivery runs.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {active.map((s) => (
                  <RunCard key={s.id} summary={s} />
                ))}
              </div>
            )}
          </section>

          {completed.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900">
                Completed ({completed.length})
              </h2>
              <div className="mt-3 flex flex-col gap-3">
                {completed.map((s) => (
                  <RunCard key={s.id} summary={s} />
                ))}
              </div>
            </section>
          )}
        </Container>
      </main>
    </>
  );
}

function RunCard({ summary: s }: { summary: DispatchBatchSummary }) {
  return (
    <Link
      href={`/dispatcher/batches/${s.id}`}
      className="group flex flex-col gap-2 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">{s.resolvedDriverName}</p>
        <p className="mt-0.5 text-sm text-slate-600">
          {s.currentRequestCount} request{s.currentRequestCount !== 1 ? "s" : ""}
          {" \u00B7 "}
          {s.totalLoads} load{s.totalLoads !== 1 ? "s" : ""}
        </p>
        {s.derivedState !== "completed" && s.totalLoads > 0 && (
          <div className="mt-1.5">
            <p className="text-xs font-medium text-slate-700">
              {s.loadsDelivered} of {s.totalLoads} load{s.totalLoads !== 1 ? "s" : ""} delivered
            </p>
            <div className="mt-1 h-1.5 w-full max-w-xs rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-blue-600 transition-all"
                style={{ width: `${Math.round((s.loadsDelivered / s.totalLoads) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Created {formatSabaDateTime(s.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_COLORS[s.derivedState]}`}
        >
          {STATE_LABELS[s.derivedState]}
        </span>
        <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 group-hover:bg-white">
          View Run
        </span>
      </div>
    </Link>
  );
}
