"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { WaterRequest } from "@/lib/domain/types";

import { markDelivered, type MarkDeliveredActionState } from "./actions";

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
        {deliveries.map((req) => (
          <DeliveryCard
            key={req.id}
            request={req}
            customer={
              req.customer
                ? { displayName: req.customer.displayName, phone: req.customer.phone }
                : req.customerId
                  ? customerInfo[req.customerId]
                  : undefined
            }
          />
        ))}
      </div>
    </Card>
  );
}

const initialState: MarkDeliveredActionState = { status: "idle" };

function DeliveryCard({
  request,
  customer,
}: {
  request: WaterRequest;
  customer?: CustomerInfo;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(markDelivered, initialState);

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">
          Delivery marked as complete.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
      <p className="font-medium text-slate-900">
        1,000 gal &mdash; {request.village}
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
          <dd className="text-slate-900">{request.deliveryDirections}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-slate-500">Requested:</dt>
          <dd className="text-slate-900">{formatDate(request.requestedAt)}</dd>
        </div>
        {request.claimedAt && (
          <div className="flex gap-2">
            <dt className="font-medium text-slate-500">Claimed:</dt>
            <dd className="text-slate-900">{formatDate(request.claimedAt)}</dd>
          </div>
        )}
      </dl>

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      {/* Mark delivered with confirmation step */}
      {!confirming ? (
        <div className="mt-3">
          <Button
            size="md"
            onClick={() => setConfirming(true)}
            className="w-full"
          >
            Mark Delivered
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            Confirm that you have delivered 1,000 gallons to this address?
          </p>
          <form action={formAction} className="mt-2 flex gap-2">
            <input type="hidden" name="requestId" value={request.id} />
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "Submitting\u2026" : "Yes, delivered"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
