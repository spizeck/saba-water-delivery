"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EligibleDriverOption } from "@/lib/domain/driverRegistry";
import type { DispatchPriority, WaterRequestStatus } from "@/lib/domain/types";

import { SABA_VILLAGES } from "@/lib/domain/villages";
import type { RequestedLoads } from "@/lib/domain/quantity";
import { REQUEST_NOTES_MAX_LENGTH } from "@/lib/domain/requestNotes";

import {
  assignRequest,
  cancelRequest,
  changePriority,
  confirmUnregisteredDelivery,
  editRequest,
  escalateRequest,
  markDeliveredByStaff,
  reassignRequest,
  resolveDisputeAsCompleted,
  returnRequestToQueue,
  resolveDisputeAsReopened,
  type RequestActionState,
} from "../actions";

const initialState: RequestActionState = { status: "idle" };

interface Props {
  requestId: string;
  status: WaterRequestStatus;
  eligibleDrivers: EligibleDriverOption[];
  /** True when this is an unregistered customer's delivered (awaiting confirmation) request. */
  canConfirmUnregisteredDelivery: boolean;
  currentPriority: DispatchPriority;
  /** Current field values for the edit form. */
  currentLoads: RequestedLoads;
  currentVillage: string;
  currentDeliveryDirections: string;
  currentRequestNotes: string;
  currentCustomerName: string;
  currentCustomerPhone: string;
  currentCustomerEmail: string;
  registeredCustomer: boolean;
  /** Whether collection records exist (locks quantity editing). */
  hasCollections: boolean;
}

export function RequestActions({
  requestId,
  status,
  eligibleDrivers,
  canConfirmUnregisteredDelivery,
  currentPriority,
  currentLoads,
  currentVillage,
  currentDeliveryDirections,
  currentRequestNotes,
  currentCustomerName,
  currentCustomerPhone,
  currentCustomerEmail,
  registeredCustomer,
  hasCollections,
}: Props) {
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const isDisputed = status === "disputed";
  const isAssignable = status === "available" || status === "preferred_driver_hold";
  const isClaimed = status === "claimed";
  const isEditable = ["requested", "preferred_driver_hold", "available"].includes(status);
  const isCancellable = ["requested", "preferred_driver_hold", "available", "claimed"].includes(status);
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
        {isAssignable && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "escalate" ? null : "escalate")}
            className="text-sm !h-9 !px-3"
          >
            Escalate
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
        {isClaimed && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "markDelivered" ? null : "markDelivered")}
            className="text-sm !h-9 !px-3"
          >
            Mark Delivered
          </Button>
        )}
        {isClaimed && !hasCollections && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "returnToQueue" ? null : "returnToQueue")}
            className="text-sm !h-9 !px-3"
          >
            Return to queue
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
        {isCancellable && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "cancel" ? null : "cancel")}
            className="text-sm !h-9 !px-3"
          >
            Cancel request
          </Button>
        )}
        {isEditable && (
          <Button
            size="md"
            variant="outline"
            onClick={() => setActivePanel(activePanel === "edit" ? null : "edit")}
            className="text-sm !h-9 !px-3"
          >
            Edit request
          </Button>
        )}
        <Button
          size="md"
          variant="outline"
          onClick={() => setActivePanel(activePanel === "priority" ? null : "priority")}
          className="text-sm !h-9 !px-3"
        >
          Change priority
        </Button>
        {!isUnresolved && (
          <p className="text-sm text-slate-500 py-2">This request is resolved.</p>
        )}
      </div>

      {status === "delivered" && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          {canConfirmUnregisteredDelivery
            ? "The driver or staff has recorded delivery. Call the customer to verify receipt, then use Confirm delivery (unregistered) to close the request."
            : "The driver or staff has recorded delivery. The registered customer must confirm or dispute receipt in the resident portal; otherwise it will auto-confirm after the confirmation window."}
        </div>
      )}

      {activePanel === "edit" && (
        <EditRequestPanel
          requestId={requestId}
          currentLoads={currentLoads}
          currentVillage={currentVillage}
          currentDeliveryDirections={currentDeliveryDirections}
          currentRequestNotes={currentRequestNotes}
          currentCustomerName={currentCustomerName}
          currentCustomerPhone={currentCustomerPhone}
          currentCustomerEmail={currentCustomerEmail}
          registeredCustomer={registeredCustomer}
          hasCollections={hasCollections}
          onDone={() => setActivePanel(null)}
        />
      )}
      {activePanel === "priority" && (
        <ChangePriorityPanel
          requestId={requestId}
          currentPriority={currentPriority}
          onDone={() => setActivePanel(null)}
        />
      )}
      {activePanel === "resolveComplete" && (
        <ResolveCompletePanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "resolveReopen" && (
        <ResolveReopenPanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "assign" && (
        <AssignPanel requestId={requestId} drivers={eligibleDrivers} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "escalate" && (
        <EscalatePanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "reassign" && (
        <ReassignPanel requestId={requestId} drivers={eligibleDrivers} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "returnToQueue" && (
        <ReturnToQueuePanel requestId={requestId} onDone={() => setActivePanel(null)} />
      )}
      {activePanel === "markDelivered" && (
        <MarkDeliveredPanel requestId={requestId} onDone={() => setActivePanel(null)} />
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

function EditRequestPanel({
  requestId,
  currentLoads,
  currentVillage,
  currentDeliveryDirections,
  currentRequestNotes,
  currentCustomerName,
  currentCustomerPhone,
  currentCustomerEmail,
  registeredCustomer,
  hasCollections,
  onDone,
}: {
  requestId: string;
  currentLoads: RequestedLoads;
  currentVillage: string;
  currentDeliveryDirections: string;
  currentRequestNotes: string;
  currentCustomerName: string;
  currentCustomerPhone: string;
  currentCustomerEmail: string;
  registeredCustomer: boolean;
  hasCollections: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(editRequest, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">Edit request and customer information</p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Customer name</span>
        <input name="customerDisplayName" required defaultValue={currentCustomerName} className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Customer phone</span>
        <input name="customerPhone" required defaultValue={currentCustomerPhone} className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Customer email</span>
        <input name="customerEmail" type="email" defaultValue={currentCustomerEmail} className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none" />
      </label>
      {registeredCustomer && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="updateCustomerProfile" value="true" className="mt-1" />
          Also update the registered customer’s saved profile. This does not change their sign-in email.
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">
          Quantity
          {hasCollections && (
            <span className="ml-1 text-xs font-normal text-slate-500">(locked — water already collected)</span>
          )}
        </span>
        <select
          name="loads"
          defaultValue={currentLoads}
          disabled={hasCollections}
          className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
        >
          <option value="1">1 load (1,000 gal)</option>
          <option value="2">2 loads (2,000 gal)</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Village</span>
        <select
          name="village"
          defaultValue={currentVillage}
          className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
        >
          {SABA_VILLAGES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Delivery directions</span>
        <textarea
          name="deliveryDirections"
          defaultValue={currentDeliveryDirections}
          rows={2}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Notes / Comments (optional)</span>
        <textarea
          name="requestNotes"
          defaultValue={currentRequestNotes}
          maxLength={REQUEST_NOTES_MAX_LENGTH}
          rows={3}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
        />
      </label>

      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Saving\u2026" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

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

function ReturnToQueuePanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(returnRequestToQueue, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-amber-900">Return this request to the normal queue</p>
      <p className="text-xs text-amber-800">This clears the driver assignment and any delivery-run membership without changing the original request date or priority.</p>
      <input name="reason" required placeholder="Reason for returning to queue (required)" className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none" />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Returning…" : "Return to queue"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">Cancel</Button>
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

function ChangePriorityPanel({
  requestId,
  currentPriority,
  onDone,
}: {
  requestId: string;
  currentPriority: DispatchPriority;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(changePriority, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-slate-700">
        Change dispatch priority (currently {currentPriority})
      </p>
      <select
        name="newPriority"
        defaultValue={currentPriority}
        required
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      >
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="critical">Critical</option>
      </select>
      <input
        name="reason"
        required
        placeholder="Reason for this change (required)"
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
      />
      <p className="text-xs text-slate-500">
        This is audited with your name, the reason, and the previous priority.
      </p>
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Saving\u2026" : "Save priority"}
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

function MarkDeliveredPanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(markDeliveredByStaff, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-amber-900">Mark this delivery complete</p>
      <p className="text-xs text-amber-800">
        Only use this when the driver could not mark it delivered themselves.
        The request will enter the normal 24-hour confirmation window.
      </p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="How the delivery was verified (e.g. driver confirmed by phone)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Recording\u2026" : "Record delivery"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EscalatePanel({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(escalateRequest, initialState);
  if (state.status === "success") return <p className="mt-3 text-sm text-green-700">{state.message}</p>;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm font-medium text-amber-900">Escalate this request</p>
      <p className="text-xs text-amber-800">
        Moves this load ahead in the dispatch queue for the next valid
        driver. The original request time and priority are preserved.
      </p>
      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Why this request needs to jump the queue"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
      />
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Escalating\u2026" : "Escalate"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-sm !h-9 !px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}
