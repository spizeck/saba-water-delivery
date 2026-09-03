"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import type { DriverRegistryEntry } from "@/lib/domain/types";
import { formatSabaTime, startOfSabaDay } from "@/lib/utils/datetime";

import {
  restrictDriver,
  restoreDriver,
  type DriverActionState,
} from "./actions";
import {
  type DriverOperationalState,
  type DriverRunSummary,
  type DriverWorkload,
} from "./deriveDriverWorkloads";

const initialState: DriverActionState = { status: "idle" };

interface Props {
  drivers: DriverRegistryEntry[];
  workloads: Record<string, DriverWorkload>;
}

export function DriverList({ drivers, workloads }: Props) {
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
          <DriverRow
            key={driver.id}
            driver={driver}
            workload={workloads[driver.id] ?? null}
          />
        ))}
      </div>
    </Card>
  );
}

const STATE_LABEL: Record<DriverOperationalState, string> = {
  offline: "Offline",
  available: "Online · Available",
  individual: "Online · Delivering",
  delivery_run: "Online · Delivery Run",
};

function DriverRow({
  driver,
  workload,
}: {
  driver: DriverRegistryEntry;
  workload: DriverWorkload | null;
}) {
  const [action, setAction] = useState<"restrict" | "restore" | null>(null);

  const isEligible = driver.eligibilityStatus === "eligible";
  const now = new Date();
  const cooldownUntil = driver.cooldownUntil ? new Date(driver.cooldownUntil) : null;
  const inCooldown = cooldownUntil !== null && cooldownUntil.getTime() > now.getTime();
  const endOfToday = startOfSabaDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const dailyCooldown = inCooldown && cooldownUntil.getTime() >= endOfToday.getTime();

  const state: DriverOperationalState = workload?.state ?? "offline";
  const hasWork = workload ? workload.openRequests > 0 : false;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">
            {driver.displayName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                state === "available"
                  ? "bg-green-50 text-green-800"
                  : state === "individual" || state === "delivery_run"
                    ? "bg-indigo-50 text-indigo-800"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {STATE_LABEL[state]}
            </span>
            <span className={isEligible ? "text-green-700" : "text-red-700 font-medium"}>
              {isEligible ? "Eligible" : "Ineligible"}
            </span>
            {dailyCooldown && (
              <span className="text-amber-700 font-medium">Daily limit reached</span>
            )}
            {!dailyCooldown && inCooldown && (
              <span className="text-amber-700 font-medium">
                Cooldown until {formatSabaTime(cooldownUntil)}
              </span>
            )}
            {!driver.linkedUserId && (
              <span className="text-slate-400">No account linked</span>
            )}
            {driver.ineligibilityReason && (
              <span className="text-red-600">{driver.ineligibilityReason}</span>
            )}
          </div>

          {hasWork && workload && (
            <div className="mt-2 flex flex-col gap-2">
              {workload.runs.map((run) => (
                <ActiveRun key={run.batchId} run={run} />
              ))}
              {workload.individualRequests.map((req) => (
                <ActiveRequest key={req.requestId} request={req} />
              ))}
            </div>
          )}
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

function ActiveRun({ run }: { run: DriverRunSummary }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-md bg-slate-50 p-2 text-xs">
      <div>
        <span className="font-medium text-slate-800">Delivery Run</span>
        <span className="ml-2 text-slate-600">
          {run.remainingStops} delivery{run.remainingStops !== 1 ? "ies" : "y"} remaining
          {" · "}
          {run.remainingLoads} load{run.remainingLoads !== 1 ? "s" : ""} remaining
        </span>
      </div>
      <Link
        href={run.link}
        className="font-medium text-blue-700 hover:underline"
      >
        View Delivery Run
      </Link>
    </div>
  );
}

function ActiveRequest({ request }: { request: { requestId: string; customerName: string; village: string; loads: number } }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-md bg-slate-50 p-2 text-xs">
      <div>
        <span className="font-medium text-slate-800">{request.customerName}</span>
        <span className="ml-2 text-slate-600">
          {request.village} · {formatWaterQuantity(request.loads as 1 | 2)}
        </span>
      </div>
      <Link
        href={`/dispatcher/${request.requestId}`}
        className="font-medium text-blue-700 hover:underline"
      >
        View Request
      </Link>
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
