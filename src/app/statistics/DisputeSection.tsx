import { Card } from "@/components/ui/Card";
import type { DisputeMetrics } from "@/lib/domain/statistics";

interface DisputeSectionProps {
  metrics: DisputeMetrics;
}

export function DisputeSection({ metrics }: DisputeSectionProps) {
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Disputes</h2>
      <p className="mt-1 text-xs text-slate-500">
        Dispute rate = disputes created / requests that reached delivered status
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Total disputes</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {metrics.disputesCreated}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Unresolved</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              metrics.unresolvedDisputes > 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {metrics.unresolvedDisputes}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Dispute rate</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {metrics.disputeRate !== null ? `${metrics.disputeRate}%` : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Resolved total</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {metrics.resolvedDisputes}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">
            Resolved as completed
          </p>
          <p className="mt-0.5 text-lg font-bold text-green-700">
            {metrics.resolvedAsCompleted}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Reopened</p>
          <p className="mt-0.5 text-lg font-bold text-amber-700">
            {metrics.resolvedAsReopened}
          </p>
        </div>
      </div>
    </Card>
  );
}
