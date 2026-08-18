import { Card } from "@/components/ui/Card";
import type { WaterRequest } from "@/lib/domain/types";

interface CustomerInfo {
  displayName: string;
  phone: string | null;
}

interface Props {
  deliveries: WaterRequest[];
  customerInfo: Record<string, CustomerInfo>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ClaimedDeliveries({ deliveries, customerInfo }: Props) {
  if (deliveries.length === 0) return null;

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">
        My deliveries ({deliveries.length})
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        {deliveries.map((req) => {
          const customer = customerInfo[req.customerId];
          return (
            <div
              key={req.id}
              className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4"
            >
              <p className="font-medium text-slate-900">
                1,000 gal &mdash; {req.village}
              </p>
              <dl className="mt-2 flex flex-col gap-1 text-sm">
                <div className="flex gap-2">
                  <dt className="font-medium text-slate-500">Customer:</dt>
                  <dd className="text-slate-900">
                    {customer?.displayName ?? "Unknown"}
                  </dd>
                </div>
                {customer?.phone && (
                  <div className="flex gap-2">
                    <dt className="font-medium text-slate-500">Phone:</dt>
                    <dd className="text-slate-900">
                      <a href={`tel:${customer.phone}`} className="underline">
                        {customer.phone}
                      </a>
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="font-medium text-slate-500">Directions:</dt>
                  <dd className="text-slate-900">{req.deliveryDirections}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-medium text-slate-500">Requested:</dt>
                  <dd className="text-slate-900">{formatDate(req.requestedAt)}</dd>
                </div>
                {req.claimedAt && (
                  <div className="flex gap-2">
                    <dt className="font-medium text-slate-500">Claimed:</dt>
                    <dd className="text-slate-900">{formatDate(req.claimedAt)}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
