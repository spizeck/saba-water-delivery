import { Card } from "@/components/ui/Card";
import type { DriverMetrics } from "@/lib/domain/statistics";

interface DriverTableProps {
  drivers: DriverMetrics[];
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function DriverTable({ drivers }: DriverTableProps) {
  if (drivers.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">
          Driver Operations
        </h2>
        <p className="mt-2 text-sm text-slate-500">No driver activity for this period.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Driver Operations</h2>
      <p className="mt-1 text-xs text-slate-500">
        Delivery metrics by driver
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-2 font-medium text-slate-500">Driver</th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Claimed
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Delivered
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Confirmed
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Avg Time
              </th>
              <th className="pb-2 text-right font-medium text-slate-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drivers.map((d) => (
              <tr key={d.driverId}>
                <td className="py-2 font-medium text-slate-900">
                  {d.displayName}
                </td>
                <td className="py-2 text-right text-slate-700">
                  {d.loadsClaimed}
                </td>
                <td className="py-2 text-right text-slate-700">
                  {d.loadsDelivered}
                </td>
                <td className="py-2 text-right text-slate-700">
                  {d.confirmedDeliveries}
                </td>
                <td className="py-2 text-right text-slate-700">
                  {formatDuration(d.avgClaimToDeliveryHours)}
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.eligibilityStatus === "eligible"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {d.eligibilityStatus === "eligible" ? "Eligible" : "Ineligible"}
                  </span>
                  <span
                    className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.availabilityStatus === "online"
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {d.availabilityStatus === "online" ? "Online" : "Offline"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
