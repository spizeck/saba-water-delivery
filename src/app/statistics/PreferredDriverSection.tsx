import { Card } from "@/components/ui/Card";
import type { PreferredDriverMetrics } from "@/lib/domain/statistics";

interface PreferredDriverSectionProps {
  metrics: PreferredDriverMetrics;
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function PreferredDriverSection({ metrics }: PreferredDriverSectionProps) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Preferred Driver</h2>
      <p className="mt-1 text-xs text-slate-500">
        Usage of the preferred-driver selection feature
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Requests with preference
          </p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {metrics.requestsWithPreference}
          </p>
          <p className="text-xs text-slate-400">
            {metrics.percentWithPreference}% of all requests
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">
            Claimed by preferred
          </p>
          <p className="mt-0.5 text-lg font-bold text-green-700">
            {metrics.claimedByPreferred}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">
            Expired to general queue
          </p>
          <p className="mt-0.5 text-lg font-bold text-amber-700">
            {metrics.expiredToGeneralQueue}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Avg delivery time (with preference)
          </p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {formatDuration(metrics.avgDeliveryTimePreferredHours)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">
            Avg delivery time (no preference)
          </p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {formatDuration(metrics.avgDeliveryTimeNoPreferenceHours)}
          </p>
        </div>
      </div>
    </Card>
  );
}
