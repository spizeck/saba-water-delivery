"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DeleteDriverEligibility } from "@/lib/domain/driverRegistry";
import type { DriverRegistryEntry } from "@/lib/domain/types";

import {
  archiveDriverAction,
  deleteDriverAction,
  restoreArchivedDriverAction,
  type DeleteDriverActionState,
  type DriverFormActionState,
} from "../actions";

const archiveInitial: DriverFormActionState = { status: "idle" };
const deleteInitial: DeleteDriverActionState = { status: "idle" };

export interface LifecyclePanelProps {
  driver: DriverRegistryEntry;
  eligibility: DeleteDriverEligibility;
}

export function LifecyclePanel({ driver, eligibility }: LifecyclePanelProps) {
  const isArchived = Boolean(driver.archivedAt);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Lifecycle</h2>
      <p className="mt-1 text-xs text-slate-500">
        Archive preserves history; permanent deletion is only allowed for safe, unreferenced test records.
      </p>

      <div className="mt-3">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isArchived ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
          }`}
        >
          {isArchived ? "Archived" : "Active"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-6">
        {isArchived ? (
          <RestoreForm driverId={driver.id} />
        ) : (
          <>
            <ArchiveForm driverId={driver.id} />
            <DeleteSection driver={driver} eligibility={eligibility} />
          </>
        )}
      </div>
    </Card>
  );
}

function ArchiveForm({ driverId }: { driverId: string }) {
  const [state, formAction, pending] = useActionState(archiveDriverAction, archiveInitial);
  const [reason, setReason] = useState("");

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">{state.message}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="driverId" value={driverId} />
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Reason for archiving
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          placeholder="e.g. Left the roster — historical deliveries retained"
          className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        size="md"
        disabled={pending || !reason.trim()}
        className="!h-8 self-start !text-xs !border-amber-200 !text-amber-700 hover:!bg-amber-50"
      >
        {pending ? "Archiving..." : "Archive Driver"}
      </Button>
      {state.status === "error" && <p className="text-xs font-medium text-red-700">{state.message}</p>}
    </form>
  );
}

function RestoreForm({ driverId }: { driverId: string }) {
  const [state, formAction, pending] = useActionState(restoreArchivedDriverAction, archiveInitial);

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">{state.message}</p>;
  }

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
        {pending ? "Restoring..." : "Restore from Archive"}
      </Button>
      {state.status === "error" && <p className="mt-2 text-xs font-medium text-red-700">{state.message}</p>}
    </form>
  );
}

function DeleteSection({ driver, eligibility }: { driver: DriverRegistryEntry; eligibility: DeleteDriverEligibility }) {
  const [state, formAction, pending] = useActionState(deleteDriverAction, deleteInitial);
  const [confirmation, setConfirmation] = useState("");

  if (state.status === "success") {
    return <p className="text-sm font-medium text-green-700">{state.message}</p>;
  }

  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-4">
      <h3 className="text-sm font-bold text-red-900">Delete Test/Unused Record</h3>

      {!eligibility.canDelete ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-red-800">
            This driver record cannot be permanently deleted:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-red-700">
            {eligibility.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <form action={formAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="driverId" value={driver.id} />

          <div className="text-xs text-slate-700">
            <p className="font-medium">This record is safe to delete:</p>
            <ul className="mt-1 list-inside list-disc text-slate-600">
              <li>Driver name: <strong>{driver.displayName}</strong></li>
              <li>Account: {eligibility.summary.linkedAccount ? "linked" : "unlinked"}</li>
              {!eligibility.summary.linkedAccount && <li>No application account is linked.</li>}
              {eligibility.summary.historicalAssignments === 0 && <li>No historical water requests reference this record.</li>}
              {eligibility.summary.preferredDriverReferences === 0 && <li>No preferred-driver references.</li>}
              {eligibility.summary.meterAssignments === 0 && <li>No meter assignments.</li>}
              {eligibility.summary.registryEvents === 0 && <li>No audit events to preserve.</li>}
            </ul>
            <p className="mt-2 font-medium text-red-800">
              Deleting removes this Driver Registry record and any unique name/phone keys. It does NOT delete any Firebase Authentication account.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Type the driver name to confirm deletion
            <input
              name="confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
              placeholder={driver.displayName}
              className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
            />
          </label>

          <Button
            type="submit"
            variant="outline"
            size="md"
            disabled={pending || confirmation.trim().toLowerCase() !== driver.displayName.toLowerCase()}
            className="!h-8 self-start !text-xs !border-red-300 !text-red-700 hover:!bg-red-100"
          >
            {pending ? "Deleting..." : "Permanently Delete Record"}
          </Button>

          {state.status === "error" && <p className="text-xs font-medium text-red-700">{state.message}</p>}
        </form>
      )}
    </div>
  );
}
