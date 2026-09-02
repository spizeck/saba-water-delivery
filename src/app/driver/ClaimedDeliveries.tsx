"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { FillStation, MeterAssignment, WaterRequest } from "@/lib/domain/types";
import { areAllLoadsCollected } from "@/lib/domain/loadCollection";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { markDelivered, type MarkDeliveredActionState } from "./actions";
import { WaterCollectionSection } from "./WaterCollectionSection";

interface CustomerInfo {
  displayName: string;
  phone: string | null;
}

interface Props {
  deliveries: WaterRequest[];
  customerInfo: Record<string, CustomerInfo>;
  stations: FillStation[];
  meters: MeterAssignment[];
}

const formatDate = formatSabaDateTime;

export function ClaimedDeliveries({ deliveries, customerInfo, stations, meters }: Props) {
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
            stations={stations}
            meters={meters}
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
  stations,
  meters,
}: {
  request: WaterRequest;
  customer?: CustomerInfo;
  stations: FillStation[];
  meters: MeterAssignment[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(markDelivered, initialState);
  const allCollected = areAllLoadsCollected(request.loads, request.loadCollections);

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
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-900">
          {formatWaterQuantity(request.loads)} &mdash; {request.village}
        </p>
        {request.dispatchBatchId && (
          <span className="inline-flex shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-900">
            Delivery run
          </span>
        )}
        {request.dispatchPriority === "critical" && (
          <span className="inline-flex shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
            Critical
          </span>
        )}
        {request.dispatchPriority === "urgent" && (
          <span className="inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Urgent
          </span>
        )}
      </div>
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
        {request.requestNotes && (
          <div className="flex gap-2">
            <dt className="font-medium text-slate-500">Notes:</dt>
            <dd className="whitespace-pre-wrap text-slate-900">{request.requestNotes}</dd>
          </div>
        )}
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

      {/* Water collection section */}
      <WaterCollectionSection
        requestId={request.id}
        loads={request.loads}
        loadCollections={request.loadCollections}
        stations={stations}
        meters={meters}
      />

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      {/* Mark delivered with confirmation step */}
      {!allCollected ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-600">
            Record water collection for all loads before marking delivered.
          </p>
        </div>
      ) : !confirming ? (
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
            Confirm that you have delivered {formatWaterQuantity(request.loads).toLowerCase()} to this address?
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
