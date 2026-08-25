"use client";

import { useActionState, useState } from "react";

import { recordBatchDelivery } from "@/app/dispatcher/actions";
import type { RequestActionState } from "@/app/dispatcher/actions";
import { Button } from "@/components/ui/Button";

const initialState: RequestActionState = { status: "idle" };

/**
 * Staff paper-reconciliation control for a batch-assigned load whose
 * driver could not (or did not) mark it delivered through the driver
 * app — see PRODUCT.md "Batch Dispatch" and docs/INCIDENT_RECOVERY.md.
 * Only offered for loads still in `"claimed"` status; once recorded,
 * the request proceeds through the same delivered/confirm/dispute
 * workflow as any other delivery.
 */
export function RecordBatchDeliveryButton({ requestId }: { requestId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(recordBatchDelivery, initialState);

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">Delivery recorded.</p>;
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => setConfirming(true)}
        className="text-sm !h-9 !px-3"
      >
        Record Delivery (paper reconciliation)
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <p className="text-sm text-amber-900">
        Only confirm after verifying with the driver that this load was
        physically delivered — this records the delivery on the driver&apos;s
        behalf, for a driver who could not use the app.
      </p>
      {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Recording\u2026" : "Yes, this was delivered"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-sm !h-9 !px-3"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
