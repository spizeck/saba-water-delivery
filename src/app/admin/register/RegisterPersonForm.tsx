"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SABA_VILLAGES } from "@/lib/domain/villages";

import { registerPersonAction, type RegisterPersonActionState } from "../actions";

const initialState: RegisterPersonActionState = { status: "idle" };

export function RegisterPersonForm() {
  const [state, formAction, pending] = useActionState(registerPersonAction, initialState);
  const [includeDriver, setIncludeDriver] = useState(false);

  return (
    <Card>
      <h1 className="text-xl font-bold text-slate-900">Register Person</h1>
      <p className="mt-1 text-sm text-slate-600">
        Create an operational record for a resident or driver. The person
        will be immediately available in the system for water requests and
        dispatch. They will not have portal login access until a future
        authentication method is linked.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        {/* Hidden field for duplicate override */}
        {state.status === "duplicate_warning" && (
          <input type="hidden" name="overrideDuplicate" value="true" />
        )}

        {/* Name */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            Full name <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            name="displayName"
            required
            autoComplete="name"
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {/* Phone */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            Phone number <span className="text-red-600">*</span>
          </span>
          <input
            type="tel"
            name="phone"
            required
            autoComplete="tel"
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {/* Email (optional) */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            Email <span className="text-xs font-normal text-slate-400">(optional)</span>
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {/* Village */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Village</span>
          <select
            name="village"
            className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="">Not set</option>
            {SABA_VILLAGES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>

        {/* Delivery directions */}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            Delivery directions
          </span>
          <textarea
            name="deliveryDirections"
            rows={2}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {/* Roles */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-700">Roles</legend>
          <p className="text-xs text-slate-500">
            Resident is always included. Check additional roles as needed.
          </p>
          <input type="hidden" name="roles" value="resident" />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="roles"
              value="driver"
              checked={includeDriver}
              onChange={(e) => setIncludeDriver(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">Driver</span>
          </label>
        </fieldset>

        {includeDriver && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">
              Adding the driver role here creates the user record with that
              role. You will still need to create a Driver Registry entry
              and link it from <strong>Admin &rarr; Driver Registry</strong> for
              the driver to be eligible for dispatch.
            </p>
          </div>
        )}

        {/* Duplicate warning */}
        {state.status === "duplicate_warning" && state.duplicates && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">{state.message}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {state.duplicates.map((d) => (
                <li key={d.uid} className="text-xs text-amber-800">
                  <span className="font-medium">{d.displayName}</span>
                  {d.phone ? ` \u00b7 ${d.phone}` : ""}
                  {d.email ? ` \u00b7 ${d.email}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-800">
              If this is a different person, submit again to proceed.
            </p>
          </div>
        )}

        {/* Error */}
        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">
            This person will not have portal login access. They can receive
            water through dispatcher-created requests immediately. A future
            phone/SMS login can be linked to this record without creating a
            duplicate.
          </p>
        </div>

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Registering\u2026" : "Register Person"}
        </Button>
      </form>
    </Card>
  );
}
