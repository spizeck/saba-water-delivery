"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverRegistryEntry } from "@/lib/domain/types";

import {
  restoreDriverEntryAction,
  restrictDriverEntryAction,
  type DriverFormActionState,
} from "../actions";

const initialState: DriverFormActionState = { status: "idle" };

export function EligibilityPanel({ driver }: { driver: DriverRegistryEntry }) {
  const isEligible = driver.eligibilityStatus === "eligible";

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Delivery Eligibility</h2>
      <div className="mt-3 flex items-center gap-3">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isEligible ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {isEligible ? "Eligible" : "Ineligible"}
        </span>
        {!isEligible && driver.ineligibilityReason && (
          <span className="text-xs text-slate-600">{driver.ineligibilityReason}</span>
        )}
      </div>

      <div className="mt-4">
        {isEligible ? <RestrictForm driverId={driver.id} /> : <RestoreForm driverId={driver.id} />}
      </div>
    </Card>
  );
}

function RestrictForm({ driverId }: { driverId: string }) {
  const [state, formAction, pending] = useActionState(restrictDriverEntryAction, initialState);
  const [reason, setReason] = useState("");

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">{state.message}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="driverId" value={driverId} />
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Reason for restriction
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          placeholder="e.g. Outstanding water payment"
          className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        size="md"
        disabled={pending || !reason.trim()}
        className="!h-8 self-start !text-xs !border-red-200 !text-red-700 hover:!bg-red-50"
      >
        {pending ? "Restricting..." : "Restrict Delivery Access"}
      </Button>
      {state.status === "error" && (
        <p className="text-xs font-medium text-red-700">{state.message}</p>
      )}
    </form>
  );
}

function RestoreForm({ driverId }: { driverId: string }) {
  const [state, formAction, pending] = useActionState(restoreDriverEntryAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="driverId" value={driverId} />
      <Button
        type="submit"
        variant="outline"
        size="md"
        disabled={pending}
        className="!h-8 !text-xs !border-green-200 !text-green-700 hover:!bg-green-50"
      >
        {pending ? "Restoring..." : "Restore Delivery Access"}
      </Button>
      {state.status === "success" && (
        <p className="mt-2 text-xs font-medium text-green-700">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="mt-2 text-xs font-medium text-red-700">{state.message}</p>
      )}
    </form>
  );
}
