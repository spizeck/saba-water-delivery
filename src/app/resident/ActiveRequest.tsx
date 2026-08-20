"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { WaterRequest, WaterRequestStatus } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import {
  confirmDelivery,
  disputeDelivery,
  type DeliveryResponseState,
} from "./actions";

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Waiting for preferred driver",
  available: "Waiting for a driver",
  claimed: "Driver assigned",
  delivered: "Delivery marked complete",
  confirmed: "Confirmed",
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
  disputed: "bg-red-50 text-red-800",
  cancelled: "bg-slate-100 text-slate-600",
};

const formatDate = formatSabaDateTime;

interface Props {
  request: WaterRequest;
  preferredDriverName?: string | null;
}

const initialState: DeliveryResponseState = { status: "idle" };

export function ActiveRequest({ request, preferredDriverName }: Props) {
  const showConfirmation = request.status === "delivered";

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
        {request.deliveredAt && (
          <div>
            <dt className="font-medium text-slate-500">Delivered</dt>
            <dd className="text-slate-900">{formatDate(request.deliveredAt)}</dd>
          </div>
        )}
      </dl>

      {showConfirmation && <DeliveryConfirmation requestId={request.id} />}
    </Card>
  );
}

function DeliveryConfirmation({ requestId }: { requestId: string }) {
  const [mode, setMode] = useState<"prompt" | "dispute">("prompt");
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmDelivery,
    initialState,
  );
  const [disputeState, disputeAction, disputePending] = useActionState(
    disputeDelivery,
    initialState,
  );

  if (confirmState.status === "success") {
    return (
      <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
        <p className="text-sm font-medium text-green-800">{confirmState.message}</p>
      </div>
    );
  }

  if (disputeState.status === "success") {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-800">{disputeState.message}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold text-blue-900">
        Did you receive your 1,000-gallon delivery?
      </p>
      <p className="mt-1 text-xs text-blue-800">
        If you don&apos;t respond within 24 hours, this delivery will be
        automatically confirmed.
      </p>

      {confirmState.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {confirmState.message}
        </p>
      )}
      {disputeState.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {disputeState.message}
        </p>
      )}

      {mode === "prompt" && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <form action={confirmAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <Button type="submit" size="md" disabled={confirmPending}>
              {confirmPending ? "Confirming\u2026" : "Yes, received"}
            </Button>
          </form>
          <Button
            variant="outline"
            size="md"
            onClick={() => setMode("dispute")}
          >
            No, there is a problem
          </Button>
        </div>
      )}

      {mode === "dispute" && (
        <form action={disputeAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="requestId" value={requestId} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              What went wrong? (optional)
            </span>
            <textarea
              name="reason"
              rows={2}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              placeholder="Briefly describe the issue..."
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="md" disabled={disputePending}>
              {disputePending ? "Submitting\u2026" : "Report issue"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setMode("prompt")}
              disabled={disputePending}
            >
              Go back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
