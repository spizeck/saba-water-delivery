"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";

import { toggleAvailability, type AvailabilityActionState } from "./actions";

const initialState: AvailabilityActionState = { status: "idle" };

interface Props {
  currentStatus: "online" | "offline";
  /**
   * Ordinary (non-Delivery-Run) assignment state for this driver:
   *   - "none"      — nothing claimed outside a run; Go Offline is direct.
   *   - "releasable"— a claimed delivery will be returned to dispatch on
   *                   going offline, so the action needs confirmation.
   *   - "committed" — water collection is recorded; going offline will be
   *                   rejected by the server, so the copy explains why.
   */
  heldAssignment?: "none" | "releasable" | "committed";
}

export function AvailabilityToggle({
  currentStatus,
  heldAssignment = "none",
}: Props) {
  const [state, formAction, pending] = useActionState(
    toggleAvailability,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);
  const isOnline = currentStatus === "online";
  const nextStatus = isOnline ? "offline" : "online";

  // The confirmation only renders while the driver is online and holds
  // an ordinary assignment — if the server state changes underneath
  // (release, reassignment, page revalidation) `needsConfirm` goes false
  // and a stale `confirming` flag is simply ignored.
  const needsConfirm = isOnline && heldAssignment !== "none";

  return (
    <form action={formAction}>
      <input type="hidden" name="availabilityStatus" value={nextStatus} />

      {needsConfirm && confirming && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            {heldAssignment === "committed" ? (
              <>
                Your assigned delivery already has water collection recorded, so
                it cannot be released automatically. Complete the delivery or
                contact the water office — you cannot go offline while committed
                work remains.
              </>
            ) : (
              <>
                Going offline will release your assigned delivery back to
                dispatch for another driver. This counts toward today’s release
                limit.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              variant={heldAssignment === "committed" ? "outline" : "primary"}
              size="lg"
              loading={pending}
              className="w-full"
            >
              {pending ? "Updating…" : "Go Offline"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending}
              className="w-full"
              onClick={() => setConfirming(false)}
            >
              Stay Online
            </Button>
          </div>
        </div>
      )}

      {(!needsConfirm || !confirming) && (
        <Button
          type={needsConfirm ? "button" : "submit"}
          variant={isOnline ? "outline" : "primary"}
          size="lg"
          loading={pending}
          className="w-full"
          onClick={needsConfirm ? () => setConfirming(true) : undefined}
        >
          {pending ? "Updating…" : isOnline ? "Go Offline" : "Go Online"}
        </Button>
      )}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "success" && state.message && (
        <p className="mt-2 text-sm font-medium text-slate-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
