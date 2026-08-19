"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DispatchSettings } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { saveDispatchSettings, type DispatchSettingsActionState } from "./actions";

const initialState: DispatchSettingsActionState = { status: "idle" };

interface Props {
  settings: DispatchSettings;
}

export function DispatchSettingsForm({ settings }: Props) {
  const [state, formAction, pending] = useActionState(saveDispatchSettings, initialState);

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Dispatch Settings</h2>
      <p className="mt-1 text-sm text-slate-600">
        Controls how many delivery offers a driver may decline per local day
        before new offers are temporarily paused for them. This does not
        affect a driver&apos;s government eligibility.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">
              Maximum declines per day
            </span>
            <input
              type="number"
              name="maxDeclinesPerDay"
              min={1}
              step={1}
              defaultValue={settings.maxDeclinesPerDay}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">
              Decline cooldown (hours)
            </span>
            <input
              type="number"
              name="declineCooldownHours"
              min={0.5}
              step={0.5}
              defaultValue={settings.declineCooldownHours}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              required
            />
          </label>
        </div>

        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p className="text-sm font-medium text-green-700">{state.message}</p>
        )}

        <Button type="submit" size="md" disabled={pending} className="sm:w-auto">
          {pending ? "Saving\u2026" : "Save Settings"}
        </Button>

        {settings.updatedAt && (
          <p className="text-xs text-slate-500">
            Last updated {formatSabaDateTime(settings.updatedAt)}
          </p>
        )}
      </form>
    </Card>
  );
}
