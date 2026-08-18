"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EligibleDriverOption } from "@/lib/domain/drivers";

import { requestWater, type RequestWaterFormState } from "./actions";

const initialState: RequestWaterFormState = { status: "idle" };

interface Props {
  village: string;
  deliveryDirections: string;
  eligibleDrivers: EligibleDriverOption[];
}

export function WaterRequestForm({
  village,
  deliveryDirections,
  eligibleDrivers,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [preferredDriverId, setPreferredDriverId] = useState("none");
  const [state, formAction, pending] = useActionState(requestWater, initialState);

  const selectedDriver = eligibleDrivers.find((d) => d.uid === preferredDriverId);

  // After successful submission, hide the form (the parent will show the active request).
  if (state.status === "success") {
    return null;
  }

  if (!confirming) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Request water</h2>
        <p className="mt-2 text-slate-600">
          Request one 1,000-gallon load of RO water for delivery.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {eligibleDrivers.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Preferred driver (optional)
              <select
                value={preferredDriverId}
                onChange={(e) => setPreferredDriverId(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 px-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="none">No preference</option>
                {eligibleDrivers.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <Button size="lg" onClick={() => setConfirming(true)}>
            Request 1,000 Gallons
          </Button>
        </div>
      </Card>
    );
  }

  // Confirmation step
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Confirm your request</h2>

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-slate-500">Quantity</dt>
          <dd className="text-slate-900">1,000 gallons</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Delivery location</dt>
          <dd className="text-slate-900">{village}</dd>
          <dd className="text-slate-600">{deliveryDirections}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Preferred driver</dt>
          <dd className="text-slate-900">
            {selectedDriver ? selectedDriver.displayName : "No preference"}
          </dd>
        </div>
      </dl>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="preferredDriverId" value={preferredDriverId} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Submitting\u2026" : "Request Water"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Go back
        </Button>
      </form>
    </Card>
  );
}
