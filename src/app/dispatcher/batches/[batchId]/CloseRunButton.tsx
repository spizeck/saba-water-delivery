"use client";

import { useActionState, useState } from "react";

import { closeRun } from "@/app/dispatcher/actions";
import type { RequestActionState } from "@/app/dispatcher/actions";
import { Button } from "@/components/ui/Button";

const initialState: RequestActionState = { status: "idle" };

/**
 * Staff control to close/complete an active delivery run that no
 * longer has any claimed requests — e.g. orphaned prelaunch data or
 * a run whose requests were all individually reassigned/cancelled.
 */
export function CloseRunButton({ batchId }: { batchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(closeRun, initialState);

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">Run closed.</p>;
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => setConfirming(true)}
        className="text-xs !h-8 !px-3 text-slate-600"
      >
        Close Run
      </Button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-sm text-amber-900">
        This will mark the delivery run as completed. Only use this when
        all assigned requests have already been resolved or removed.
      </p>
      {state.status === "error" && (
        <p className="mt-1 text-sm text-red-700">{state.message}</p>
      )}
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-sm !h-9 !px-3">
          {pending ? "Closing\u2026" : "Yes, close this run"}
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
