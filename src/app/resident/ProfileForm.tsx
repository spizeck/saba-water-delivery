"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SABA_VILLAGES } from "@/lib/domain/villages";
import type { UserProfile } from "@/lib/domain/types";

import { updateResidentProfile, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = { status: "idle" };

const inputClasses =
  "h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none";

export function ProfileForm({ profile }: { profile: UserProfile }) {
  const [state, formAction, pending] = useActionState(updateResidentProfile, initialState);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Your profile</h2>
      <p className="mt-1 text-sm text-slate-600">
        Keep this up to date so drivers know where to deliver your water.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Display name
          <input
            name="displayName"
            defaultValue={profile.displayName}
            required
            className={inputClasses}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Email
          <input
            value={profile.email ?? "Not provided"}
            disabled
            className="h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-base text-slate-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Phone
          <input
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ""}
            placeholder="e.g. +599 000 0000"
            className={inputClasses}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Village/area
          <select
            name="village"
            defaultValue={profile.village ?? ""}
            required
            className={inputClasses}
          >
            <option value="">Select a village...</option>
            {SABA_VILLAGES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Delivery directions
          <textarea
            name="deliveryDirections"
            defaultValue={profile.deliveryDirections ?? ""}
            required
            rows={3}
            placeholder="Describe how a driver finds your home (landmarks, gate color, etc.) — a street address isn't required."
            className="rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="text-sm font-medium text-green-700">
            {state.message}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving\u2026" : "Save profile"}
        </Button>
      </form>
    </Card>
  );
}
