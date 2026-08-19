"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

import { seedInitialRosterAction, type MaintenanceActionState } from "./actions";

const initialState: MaintenanceActionState = { status: "idle" };

/**
 * One-time, admin-triggered setup action. Safe to click more than once.
 */
export function RegistryTools() {
  const [seedState, seedAction, seedPending] = useActionState(
    seedInitialRosterAction,
    initialState,
  );

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Registry Tools</h2>
      <p className="mt-1 text-xs text-slate-500">One-time setup action, safe to run more than once.</p>

      <form action={seedAction}>
        <Button type="submit" variant="outline" size="md" disabled={seedPending} className="w-full">
          {seedPending ? "Seeding\u2026" : "Seed initial roster"}
        </Button>
      </form>
      <p className="mt-1 text-xs text-slate-500">
        Creates the known current drivers and their fill-station meter
        assignments, skipping any name that already exists.
      </p>
      {seedState.message && (
        <p className="mt-1 text-xs font-medium text-slate-700">{seedState.message}</p>
      )}
    </Card>
  );
}
