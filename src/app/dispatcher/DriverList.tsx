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

const initialState: DriverActionState = { status: "idle" };

/** Compact summary of one claimed request, computed server-side. */
export interface DriverRequestSummary {
  requestId: string;
  customerName: string;
  village: string;
  loads: number;
  loadsCollected: number;
  isBatchAssigned: boolean;
  isEscalated: boolean;
}

/** Per-driver workload summary, keyed by registry ID. */
export interface DriverWorkload {
  openRequests: number;
  openLoads: number;
  requests: DriverRequestSummary[];
}

interface Props {
  drivers: DriverRegistryEntry[];
  /** Workload keyed by driver registry ID. */
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

function DriverRow({
  driver,
  workload,
}: {
  driver: DriverRegistryEntry;
  workload: DriverWorkload | null;
}) {
  const [action, setAction] = useState<"restrict" | "restore" | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isEligible = driver.eligibilityStatus === "eligible";
  const isOnline = driver.availabilityStatus === "online";
  const hasWork = workload && workload.openRequests > 0;
  const now = new Date();
  const cooldownUntil = driver.cooldownUntil ? new Date(driver.cooldownUntil) : null;
  const inCooldown = cooldownUntil !== null && cooldownUntil.getTime() > now.getTime();
  const endOfToday = startOfSabaDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const dailyCooldown = inCooldown && cooldownUntil.getTime() >= endOfToday.getTime();

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => hasWork && setExpanded(!expanded)}
            className={`text-left font-medium text-slate-900 ${hasWork ? "hover:underline cursor-pointer" : ""}`}
          >
            {driver.displayName}
          </button>
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
            <span className={isEligible ? "text-green-700" : "text-red-700 font-medium"}>
              {isEligible ? "Eligible" : "Ineligible"}
            </span>
            <span className={isOnline ? "text-green-700" : "text-slate-500"}>
              {isOnline ? "Online" : "Offline"}
            </span>
            {inCooldown && dailyCooldown && (
              <span className="text-amber-700 font-medium">Daily limit reached</span>
            )}
            {inCooldown && !dailyCooldown && (
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
            {hasWork && (
              <span className="font-medium text-indigo-700">
                {workload.openRequests} request{workload.openRequests !== 1 ? "s" : ""} &middot; {workload.openLoads} load{workload.openLoads !== 1 ? "s" : ""}
              </span>
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

      {expanded && hasWork && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="flex flex-col gap-2">
            {workload.requests.map((req) => (
              <div key={req.requestId} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <Link
                    href={`/dispatcher/${req.requestId}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {req.customerName}
                  </Link>
                  <span className="ml-1.5 text-slate-500">
                    {req.village} &middot; {formatWaterQuantity(req.loads as 1 | 2)}
                  </span>
                  {req.isBatchAssigned && (
                    <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      delivery run
                    </span>
                  )}
                  {req.isEscalated && (
                    <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      escalated
                    </span>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] font-medium ${
                  req.loadsCollected >= req.loads
                    ? "text-green-700"
                    : req.loadsCollected > 0
                      ? "text-amber-700"
                      : "text-slate-500"
                }`}>
                  {req.loadsCollected}/{req.loads} collected
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
