import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import type { DispatchPriority, WaterLoadCollection, WaterRequest, WaterRequestStatus } from "@/lib/domain/types";

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

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Preferred driver hold",
  available: "Available",
  claimed: "Claimed",
  delivered: "Delivered",
  confirmed: "Confirmed",
  disputed: "DISPUTED",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<WaterRequestStatus, string> = {
  requested: "bg-blue-50 text-blue-800",
  preferred_driver_hold: "bg-amber-50 text-amber-800",
  available: "bg-blue-50 text-blue-800",
  claimed: "bg-indigo-50 text-indigo-800",
  delivered: "bg-green-50 text-green-800",
  confirmed: "bg-green-50 text-green-700",
  disputed: "bg-red-100 text-red-900 font-bold",
  cancelled: "bg-slate-100 text-slate-500",
};

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface Props {
  requests: WaterRequest[];
  /** Customer display name, keyed by REQUEST id (see dispatcher/page.tsx). */
  customerNames: Record<string, string>;
  driverNames: Record<string, string>;
}

export function RequestList({ requests, customerNames, driverNames }: Props) {
  // Split into active and resolved for display.
  const resolved: WaterRequestStatus[] = ["confirmed", "cancelled"];
  const activeRequests = requests.filter((r) => !resolved.includes(r.status));
  const recentResolved = requests
    .filter((r) => resolved.includes(r.status))
    .slice(0, 20);

  return (
    <>
      <Card>
        <h2 className="text-xl font-bold text-slate-900">
          Active requests ({activeRequests.length})
        </h2>
        {activeRequests.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No active requests.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Priority</th>
                  <th className="pb-2 pr-3">Age</th>
                  <th className="pb-2 pr-3">Customer</th>
                  <th className="pb-2 pr-3">Qty</th>
                  <th className="pb-2 pr-3">Village</th>
                  <th className="pb-2 pr-3">Driver</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeRequests.map((req) => (
                  <tr key={req.id} className="group">
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                      {req.status === "delivered" && (
                        <span className="ml-1.5 text-[10px] font-medium text-slate-500">
                          awaiting confirmation
                        </span>
                      )}
                      {req.status === "claimed" && (
                        <CollectionProgress loads={req.loads} loadCollections={req.loadCollections} />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[req.dispatchPriority]}`}>
                        {PRIORITY_LABELS[req.dispatchPriority]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {formatAge(req.requestedAt)}
                    </td>
                    <td className="py-2 pr-3 text-slate-900">
                      {customerNames[req.id] ?? "Unknown"}
                      {req.source === "dispatcher" && (
                        <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          staff
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{formatWaterQuantity(req.loads)}</td>
                    <td className="py-2 pr-3 text-slate-600">{req.village}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {req.assignedDriverId
                        ? driverNames[req.assignedDriverId] ?? "—"
                        : req.preferredDriverId
                          ? `Pref: ${driverNames[req.preferredDriverId] ?? "—"}`
                          : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/dispatcher/${req.id}`}
                        className="text-blue-700 hover:underline text-xs font-medium"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {recentResolved.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold text-slate-900">
            Recently resolved ({recentResolved.length})
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Customer</th>
                  <th className="pb-2 pr-3">Village</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentResolved.map((req) => (
                  <tr key={req.id}>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[req.status]}`}>
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-900">
                      {customerNames[req.id] ?? "Unknown"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{req.village}</td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/dispatcher/${req.id}`}
                        className="text-blue-700 hover:underline text-xs font-medium"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function CollectionProgress({
  loads,
  loadCollections,
}: {
  loads: number;
  loadCollections: WaterLoadCollection[] | null;
}) {
  const collected = loadCollections?.length ?? 0;
  const colorClass =
    collected === 0
      ? "text-slate-500"
      : collected >= loads
        ? "text-green-700"
        : "text-amber-700";
  return (
    <span className={`ml-1.5 text-[10px] font-medium ${colorClass}`}>
      {collected}/{loads} collected
    </span>
  );
}
