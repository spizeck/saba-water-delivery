import { Card } from "@/components/ui/Card";
import type { WaterRequest, WaterRequestStatus } from "@/lib/domain/types";
import { formatSabaDate } from "@/lib/utils/datetime";

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Waiting for preferred driver",
  available: "Waiting for a driver",
  claimed: "Driver assigned",
  delivered: "Delivery marked complete",
  confirmed: "Confirmed",
  delivered_unconfirmed: "Awaiting confirmation",
  disputed: "Issue reported",
  cancelled: "Cancelled",
};

const formatDate = formatSabaDate;

interface Props {
  requests: WaterRequest[];
}

export function RequestHistory({ requests }: Props) {
  if (requests.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Request history</h2>
        <p className="mt-2 text-sm text-slate-600">No previous requests.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Request history</h2>
      <div className="mt-4 divide-y divide-slate-100">
        {requests.map((req) => (
          <div key={req.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                1,000 gal &mdash; {req.village}
              </p>
              <p className="text-xs text-slate-500">
                {formatDate(req.requestedAt)}
                {req.deliveredAt && ` \u2192 delivered ${formatDate(req.deliveredAt)}`}
                {req.confirmedAt && ` \u2192 confirmed ${formatDate(req.confirmedAt)}`}
              </p>
            </div>
            <span className="ml-2 shrink-0 text-xs font-medium text-slate-600">
              {STATUS_LABELS[req.status]}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
