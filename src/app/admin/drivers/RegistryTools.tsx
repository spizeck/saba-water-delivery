"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

import {
  importLegacyDriversAction,
  seedInitialRosterAction,
  type MaintenanceActionState,
} from "./actions";

const initialState: MaintenanceActionState = { status: "idle" };

/**
 * One-time, admin-triggered maintenance actions. Both are idempotent
 * (safe to click more than once) and never run automatically — see
 * TECHNICAL.md "Driver Registry" / "Existing Driver Data Migration".
 */
export function RegistryTools() {
  const [seedState, seedAction, seedPending] = useActionState(
    seedInitialRosterAction,
    initialState,
  );
  const [importState, importAction, importPending] = useActionState(
    importLegacyDriversAction,
    initialState,
  );

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Registry Tools</h2>
      <p className="mt-1 text-xs text-slate-500">
        One-time setup actions. Both are safe to run more than once.
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
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
        </div>

        <div className="flex-1">
          <form action={importAction}>
            <Button type="submit" variant="outline" size="md" disabled={importPending} className="w-full">
              {importPending ? "Importing\u2026" : "Import legacy driver accounts"}
            </Button>
          </form>
          <p className="mt-1 text-xs text-slate-500">
            Imports pre-registry driver accounts (created before this
            feature existed) as linked registry entries, skipping any
            account already linked.
          </p>
          {importState.message && (
            <p className="mt-1 text-xs font-medium text-slate-700">{importState.message}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
