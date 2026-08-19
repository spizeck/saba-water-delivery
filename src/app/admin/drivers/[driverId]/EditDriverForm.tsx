"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverRegistryEntry } from "@/lib/domain/types";

import { updateDriverAction, type DriverFormActionState } from "../actions";

const initialState: DriverFormActionState = { status: "idle" };

export function EditDriverForm({ driver }: { driver: DriverRegistryEntry }) {
  const [state, formAction, pending] = useActionState(updateDriverAction, initialState);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Basic Information</h2>
      <form action={formAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="driverId" value={driver.id} />
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
          Name
          <input
            name="displayName"
            defaultValue={driver.displayName}
            required
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
          Phone
          <input
            name="phone"
            defaultValue={driver.phone ?? ""}
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
        <Button type="submit" size="md" disabled={pending} className="sm:w-auto">
          {pending ? "Saving\u2026" : "Save"}
        </Button>
      </form>
      {state.status === "success" && (
        <p className="mt-2 text-sm font-medium text-green-700">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="mt-2 text-sm font-medium text-red-700">{state.message}</p>
      )}
    </Card>
  );
}
