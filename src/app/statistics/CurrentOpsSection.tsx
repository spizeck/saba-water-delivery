import { Card } from "@/components/ui/Card";
import type { CurrentOperationalMetrics } from "@/lib/domain/statistics";

interface CurrentOpsSectionProps {
  current: CurrentOperationalMetrics;
}

export function CurrentOpsSection({ current }: CurrentOpsSectionProps) {
  const hasAgingIssue = current.openOver24h > 0;

  return (
    <Card className={hasAgingIssue ? "!border-amber-200 !bg-amber-50/50" : undefined}>
      <h2 className="text-lg font-bold text-slate-900">Current Operations</h2>
      <p className="text-xs text-slate-500">
        Real-time system state (not filtered by period)
      </p>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Open requests</p>
          <p className="mt-0.5 text-xl font-bold text-slate-900">
            {current.openRequests}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Open &gt; 24h</p>
          <p
            className={`mt-0.5 text-xl font-bold ${
              current.openOver24h > 0 ? "text-amber-700" : "text-slate-900"
            }`}
          >
            {current.openOver24h}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Open &gt; 48h</p>
          <p
            className={`mt-0.5 text-xl font-bold ${
              current.openOver48h > 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {current.openOver48h}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">
            Unresolved disputes
          </p>
          <p
            className={`mt-0.5 text-xl font-bold ${
              current.unresolvedDisputes > 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {current.unresolvedDisputes}
          </p>
        </div>
      </div>

      {current.oldestRequestDate && (
        <p className="mt-3 text-xs text-slate-600">
          Oldest open request:{" "}
          <span className="font-medium">
            {new Date(current.oldestRequestDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </p>
      )}
    </Card>
  );
}
