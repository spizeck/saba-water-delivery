import { Card } from "@/components/ui/Card";
import type { WaterRequest, WaterRequestStatus } from "@/lib/domain/types";

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Waiting for preferred driver",
  available: "Waiting for a driver",
  claimed: "Driver assigned",
  delivered: "Delivery marked complete",
  confirmed: "Confirmed",
  delivered_unconfirmed: "Awaiting your confirmation",
  disputed: "Delivery issue reported",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<WaterRequestStatus, string> = {
  requested: "bg-blue-50 text-blue-800",
  preferred_driver_hold: "bg-amber-50 text-amber-800",
  available: "bg-blue-50 text-blue-800",
  claimed: "bg-indigo-50 text-indigo-800",
  delivered: "bg-green-50 text-green-800",
  confirmed: "bg-green-50 text-green-800",
  delivered_unconfirmed: "bg-amber-50 text-amber-800",
  disputed: "bg-red-50 text-red-800",
  cancelled: "bg-slate-100 text-slate-600",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  request: WaterRequest;
  preferredDriverName?: string | null;
}

export function ActiveRequest({ request, preferredDriverName }: Props) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-bold text-slate-900">Active request</h2>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[request.status]}`}
        >
          {STATUS_LABELS[request.status]}
        </span>
      </div>

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-slate-500">Quantity</dt>
          <dd className="text-slate-900">1,000 gallons</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Requested</dt>
          <dd className="text-slate-900">{formatDate(request.requestedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Delivery location</dt>
          <dd className="text-slate-900">{request.village}</dd>
          <dd className="text-slate-600">{request.deliveryDirections}</dd>
        </div>
        {preferredDriverName && (
          <div>
            <dt className="font-medium text-slate-500">Preferred driver</dt>
            <dd className="text-slate-900">{preferredDriverName}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
