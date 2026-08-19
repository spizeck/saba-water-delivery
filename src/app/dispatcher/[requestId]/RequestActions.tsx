"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EligibleDriverOption } from "@/lib/domain/driverRegistry";
import type { WaterRequestStatus } from "@/lib/domain/types";

import {
  assignRequest,
  cancelRequest,
  confirmUnregisteredDelivery,
  reassignRequest,
  resolveDisputeAsCompleted,
  resolveDisputeAsReopened,
  type RequestActionState,
} from "../actions";

const initialState: RequestActionState = { status: "idle" };

interface Props {
  requestId: string;
  status: WaterRequestStatus;
  eligibleDrivers: EligibleDriverOption[];
  /** True when this is an unregistered customer's delivered/unconfirmed request. */
  canConfirmUnregisteredDelivery: boolean;
}

export function RequestActions({
  requestId,
  status,
  eligibleDrivers,
  canConfirmUnregisteredDelivery,
}: Props) {
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const isDisputed = status === "disputed";
  const isAssignable = status === "available" || status === "preferred_driver_hold";
  const isClaimed = status === "claimed";
  const isUnresolved = !["confirmed", "cancelled"].includes(status);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Actions</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {isDisputed && (
          <>
            <Button
              size="md"
              variant="primary"
              onClick={() => setActivePanel(activePanel === "resolveComplete" ? null : "resolveComplete")}
              className="text-sm !h-9 !px-3"
            >
              Accept delivery
            </Button>
            <Button
              size="md"
              variant="outline"
              onClick={() => setActivePanel(activePanel === "resolveReopen" ? null : "resolveReopen")}
              className="text-sm !h-9 !px-3"
            >
              Reopen for retry
            </Button>
          </>
        )}
        {isAssignable && (
          <Button
            size="md"
            variant="primary"
            onClick={() => setActivePanel(activePanel === "assign" ? null : "assign")}
            className="text-sm !h-9 !px-3"
          >
            Assign driver
          </Button>
        )}
        {isClaimed && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "reassign" ? null : "reassign")}
            className="text-sm !h-9 !px-3"
          >
            Reassign
          </Button>
        )}
        {canConfirmUnregisteredDelivery && (
          <Button
            size="md"
            variant="primary"
            onClick={() => setActivePanel(activePanel === "confirmUnregistered" ? null : "confirmUnregistered")}
            className="text-sm !h-9 !px-3"
          >
            Confirm delivery (unregistered)
          </Button>
        )}
        {isUnresolved && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "cancel" ? null : "cancel")}
            className="text-sm !h-9 !px-3"
          >
            Cancel request
          </Button>
        )}
        {!isUnresolved && (
          <p className="text-sm text-slate-500 py-2">This request is resolved.</p>
        )}
      </div>

      {activePanel === "resolveComplete" && (
        <ResolveCompletePanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "resolveReopen" && (
        <ResolveReopenPanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "assign" && (
        <AssignPanel requestId={requestId} drivers={eligibleDrivers} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "reassign" && (
        <ReassignPanel requestId={requestId} drivers={eligibleDrivers} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "cancel" && (
        <CancelPanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "confirmUnregistered" && (
        <ConfirmUnregisteredPanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function ResolveCompletePanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(resolveDisputeAsCompleted, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">Accept delivery as complete</p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="Resolution note (required)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Resolving\u2026" : "Confirm resolution"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ResolveReopenPanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(resolveDisputeAsReopened, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">Reopen request for another delivery attempt</p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="Resolution note (required)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Reopening\u2026" : "Reopen request"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AssignPanel({ requestId, drivers, onDone }: { requestId: string; drivers: EligibleDriverOption[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(assignRequest, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">Assign to an eligible driver</p>
      <select
        name="driverId"
        required
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      >
        <option value="">Select driver...</option>
        {drivers.map((d) => (
          <option key={d.uid} value={d.uid}>{d.displayName}</option>
        ))}
      </select>
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Assigning\u2026" : "Assign"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReassignPanel({ requestId, drivers, onDone }: { requestId: string; drivers: EligibleDriverOption[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(reassignRequest, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">Reassign to a different driver</p>
      <select
        name="newDriverId"
        required
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      >
        <option value="">Select new driver...</option>
        {drivers.map((d) => (
          <option key={d.uid} value={d.uid}>{d.displayName}</option>
        ))}
      </select>
      <input
        name="reason"
        required
        placeholder="Reason for reassignment (required)"
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Reassigning\u2026" : "Reassign"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ConfirmUnregisteredPanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(confirmUnregisteredDelivery, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">
        Confirm this delivery on behalf of the customer
      </p>
      <p className="text-xs text-slate-500">
        This customer has no application account and cannot confirm through
        the resident portal. Only confirm after verifying the delivery was
        received.
      </p>
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Confirming\u2026" : "Confirm delivery"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CancelPanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(cancelRequest, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-red-100 bg-red-50/50 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-red-800">Cancel this request</p>
      <input
        name="reason"
        required
        placeholder="Reason for cancellation (required)"
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Cancelling\u2026" : "Cancel request"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Go back
        </Button>
      </div>
    </form>
  );
}
