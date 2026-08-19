"use client";

import { useActionState, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

import { createDriverAction, type DriverFormActionState } from "./actions";

const initialState: DriverFormActionState = { status: "idle" };

export function NewDriverForm() {
  const [state, formAction, pending] = useActionState(createDriverAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Add Driver</h2>
      <p className="mt-1 text-xs text-slate-500">
        The driver does not need an application account yet.
      </p>

      <form
        ref={formRef}
        action={(formData) => {
          formAction(formData);
          formRef.current?.reset();
        }}
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
          Name
          <input
            name="displayName"
            required
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
          Phone (optional)
          <input
            name="phone"
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
        <Button type="submit" size="md" disabled={pending} className="sm:w-auto">
          {pending ? "Adding\u2026" : "Add Driver"}
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
