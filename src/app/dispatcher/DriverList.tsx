"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverRegistryEntry } from "@/lib/domain/types";

import {
  restrictDriver,
  restoreDriver,
  type DriverActionState,
} from "./actions";

const initialState: DriverActionState = { status: "idle" };

interface Props {
  drivers: DriverRegistryEntry[];
}

export function DriverList({ drivers }: Props) {
  if (drivers.length === 0) {
    return (
      <Card>
        <h2 className="text-xl font-bold text-slate-900">Drivers</h2>
        <p className="mt-2 text-sm text-slate-600">No registered drivers.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-xl font-bold text-slate-900">
        Drivers ({drivers.length})
      </h2>
      <div className="mt-4 flex flex-col gap-3">
        {drivers.map((driver) => (
          <DriverRow key={driver.id} driver={driver} />
        ))}
      </div>
    </Card>
  );
}

function DriverRow({ driver }: { driver: DriverRegistryEntry }) {
  const [action, setAction] = useState<"restrict" | "restore" | null>(null);

  const isEligible = driver.eligibilityStatus === "eligible";
  const isOnline = driver.availabilityStatus === "online";

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{driver.displayName}</p>
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
            <span className={isEligible ? "text-green-700" : "text-red-700 font-medium"}>
              {isEligible ? "Eligible" : "Ineligible"}
            </span>
            <span className={isOnline ? "text-green-700" : "text-slate-500"}>
              {isOnline ? "Online" : "Offline"}
            </span>
            {!driver.linkedUserId && (
              <span className="text-slate-400">No account linked</span>
            )}
            {driver.ineligibilityReason && (
              <span className="text-red-600">{driver.ineligibilityReason}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {isEligible ? (
            <Button
              size="md"
              variant="outline"
              onClick={() => setAction(action === "restrict" ? null : "restrict")}
              className="text-xs !px-3 !h-8"
            >
              Restrict
            </Button>
          ) : (
            <Button
              size="md"
              variant="outline"
              onClick={() => setAction(action === "restore" ? null : "restore")}
              className="text-xs !px-3 !h-8"
            >
              Restore
            </Button>
          )}
        </div>
      </div>

      {action === "restrict" && (
        <RestrictForm driverId={driver.id} onDone={() => setAction(null)} />
      )}
      {action === "restore" && (
        <RestoreForm driverId={driver.id} onDone={() => setAction(null)} />
      )}
    </div>
  );
}

function RestrictForm({ driverId, onDone }: { driverId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(restrictDriver, initialState);

  if (state.status === "success") {
    return (
      <p className="mt-2 text-sm text-green-700">{state.message}</p>
    );
  }

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="driverId" value={driverId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Reason for restriction</span>
        <input
          name="reason"
          required
          className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-600 focus:outline-none"
          placeholder="e.g. Vehicle maintenance required"
        />
      </label>
      {state.status === "error" && (
        <p className="text-sm text-red-700">{state.message}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-xs !px-3 !h-8">
          {pending ? "Restricting\u2026" : "Restrict Delivery Access"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-xs !px-3 !h-8">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RestoreForm({ driverId, onDone }: { driverId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(restoreDriver, initialState);

  if (state.status === "success") {
    return (
      <p className="mt-2 text-sm text-green-700">{state.message}</p>
    );
  }

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="driverId" value={driverId} />
      {state.status === "error" && (
        <p className="text-sm text-red-700 mb-2">{state.message}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending} className="text-xs !px-3 !h-8">
          {pending ? "Restoring\u2026" : "Restore Delivery Access"}
        </Button>
        <Button type="button" variant="outline" size="md" onClick={onDone} className="text-xs !px-3 !h-8">
          Cancel
        </Button>
      </div>
    </form>
  );
}
