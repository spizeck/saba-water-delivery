"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverProfile } from "@/lib/domain/types";

import { adminRestrictDriver, adminRestoreDriver, type DriverActionState } from "../../actions";

interface DriverEligibilitySectionProps {
  driverId: string;
  driverProfile: DriverProfile;
}

export function DriverEligibilitySection({
  driverId,
  driverProfile,
}: DriverEligibilitySectionProps) {
  const isEligible = driverProfile.eligibilityStatus === "eligible";
  const isOnline = driverProfile.availabilityStatus === "online";

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Driver Access</h2>

      <div className="mt-4 flex items-center gap-3">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isEligible
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {isEligible ? "Eligible" : "Ineligible"}
        </span>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isOnline
              ? "bg-green-50 text-green-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      {!isEligible && driverProfile.ineligibilityReason && (
        <p className="mt-3 text-xs text-slate-600">
          <span className="font-medium">Reason:</span>{" "}
          {driverProfile.ineligibilityReason}
        </p>
      )}

      <div className="mt-4">
        {isEligible ? (
          <RestrictForm driverId={driverId} />
        ) : (
          <RestoreForm driverId={driverId} />
        )}
      </div>
    </Card>
  );
}

function RestrictForm({ driverId }: { driverId: string }) {
  const initialState: DriverActionState = { status: "idle" };
  const [state, action, pending] = useActionState(adminRestrictDriver, initialState);
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="driverId" value={driverId} />
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Reason for restriction
        <input
          type="text"
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
        className="!h-8 !text-xs !border-red-200 !text-red-700 hover:!bg-red-50"
      >
        {pending ? "Restricting..." : "Restrict Delivery Access"}
      </Button>
      {state.status === "success" && (
        <p className="text-xs font-medium text-green-700">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="text-xs font-medium text-red-700">{state.message}</p>
      )}
    </form>
  );
}

function RestoreForm({ driverId }: { driverId: string }) {
  const initialState: DriverActionState = { status: "idle" };
  const [state, action, pending] = useActionState(adminRestoreDriver, initialState);

  return (
    <form action={action}>
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
