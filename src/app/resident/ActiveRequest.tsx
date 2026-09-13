"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { WaterRequest, WaterRequestStatus } from "@/lib/domain/types";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { isResidentCancellableRequest } from "@/lib/domain/residentCancellation";

import {
  cancelOwnRequest,
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
  // Visibility only — the server action re-verifies eligibility
  // transactionally, so a stale page that still shows this button can
  // never undo a driver's claim (issue #23).
  const showCancel = isResidentCancellableRequest(request);

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
          <dd className="text-slate-900">
            {formatWaterQuantity(request.loads)}
          </dd>
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
        {request.requestNotes && (
          <div>
            <dt className="font-medium text-slate-500">Notes / Comments</dt>
            <dd className="whitespace-pre-wrap text-slate-900">
              {request.requestNotes}
            </dd>
          </div>
        )}
        {preferredDriverName && (
          <div>
            <dt className="font-medium text-slate-500">Preferred driver</dt>
            <dd className="text-slate-900">{preferredDriverName}</dd>
          </div>
        )}
        {request.deliveredAt && (
          <div>
            <dt className="font-medium text-slate-500">Delivered</dt>
            <dd className="text-slate-900">
              {formatDate(request.deliveredAt)}
            </dd>
          </div>
        )}
      </dl>

      {showConfirmation && (
        <div id="delivery-confirmation">
          <DeliveryConfirmation request={request} />
        </div>
      )}

      {showCancel && <CancelRequest requestId={request.id} />}
    </Card>
  );
}

/**
 * Secondary, deliberately low-prominence cancel affordance (issue #23):
 * a two-step confirm (never one-click) rendered below the status
 * information so it cannot compete with the primary request state.
 */
function CancelRequest({ requestId }: { requestId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    cancelOwnRequest,
    initialState,
  );

  if (state.status === "success") {
    return (
      <p className="mt-4 border-t border-slate-200 pt-4 text-sm font-medium text-green-800">
        {state.message}
      </p>
    );
  }

  if (!confirming) {
    return (
      <div className="mt-4 border-t border-slate-200 pt-4">
        <Button variant="outline" size="md" onClick={() => setConfirming(true)}>
          Cancel Request
        </Button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Cancel water request?"
      className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <p className="text-sm font-semibold text-slate-900">
        Cancel water request?
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Are you sure you want to cancel this water request? If you need water
        later, you will need to submit a new request.
      </p>

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep Request
        </Button>
        <form action={formAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button
            type="submit"
            size="md"
            variant="secondary"
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Cancel Request"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function DeliveryConfirmation({ request }: { request: WaterRequest }) {
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
        <p className="text-sm font-medium text-green-800">
          {confirmState.message}
        </p>
      </div>
    );
  }

  if (disputeState.status === "success") {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-800">
          {disputeState.message}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold text-blue-900">
        Did you receive your {formatWaterQuantity(request.loads).toLowerCase()}?
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
            <input type="hidden" name="requestId" value={request.id} />
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
          <input type="hidden" name="requestId" value={request.id} />
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
