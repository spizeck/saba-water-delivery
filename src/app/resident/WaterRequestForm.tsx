"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  EMPTY_WATER_SITUATION,
  isWaterSituationComplete,
  WaterSituationFields,
  WaterSituationHiddenFields,
} from "@/components/forms/WaterSituationFields";
import type { EligibleDriverOption } from "@/lib/domain/driverRegistry";

import { requestWater, type RequestWaterFormState } from "./actions";

const initialState: RequestWaterFormState = { status: "idle" };

interface Props {
  village: string;
  deliveryDirections: string;
  eligibleDrivers: EligibleDriverOption[];
}

const URGENCY_LABEL: Record<string, string> = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
};

const VULNERABLE_LABEL: Record<string, string> = {
  elderly: "Elderly person",
  infant_or_young_child: "Infant or young child",
  medical_need: "Medical need",
  essential_services_commercial_business: "Essential services (Commercial/business)",
};

export function WaterRequestForm({
  village,
  deliveryDirections,
  eligibleDrivers,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [preferredDriverId, setPreferredDriverId] = useState("none");
  const [waterSituation, setWaterSituation] = useState(EMPTY_WATER_SITUATION);
  const [attestationChecked, setAttestationChecked] = useState(false);
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
          <WaterSituationFields value={waterSituation} onChange={setWaterSituation} />

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

          <Button
            size="lg"
            disabled={!isWaterSituationComplete(waterSituation)}
            onClick={() => {
              setAttestationChecked(false);
              setConfirming(true);
            }}
          >
            Review &amp; Confirm Request
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
        <div>
          <dt className="font-medium text-slate-500">Water situation</dt>
          <dd className="text-slate-900">
            <span className="font-medium">Urgency:</span> {" "}
            {URGENCY_LABEL[waterSituation.reportedUrgency] || "—"}
          </dd>
          {waterSituation.vulnerableCircumstances.some((c) => c !== "none") && (
            <dd className="text-slate-900">
              <span className="font-medium">Circumstances:</span> {" "}
              {waterSituation.vulnerableCircumstances
                .filter((c) => c !== "none")
                .map((c) => VULNERABLE_LABEL[c] ?? c)
                .join(", ")}
            </dd>
          )}
          {waterSituation.personsAffected && (
            <dd className="text-slate-900">
              <span className="font-medium">People affected:</span> {" "}
              {waterSituation.personsAffected}
            </dd>
          )}
          {waterSituation.availableStorageCapacity && (
            <dd className="text-slate-900">
              <span className="font-medium">Available storage:</span> {" "}
              {waterSituation.availableStorageCapacity}
            </dd>
          )}
        </div>
      </dl>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="preferredDriverId" value={preferredDriverId} />
        <WaterSituationHiddenFields value={waterSituation} />

        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            name="attestationAccepted"
            value="true"
            checked={attestationChecked}
            onChange={(e) => setAttestationChecked(e.target.checked)}
            required
            className="mt-0.5"
          />
          <span>
            I am authorized to request water at this location, and the statements made above are
            true and factual.
          </span>
        </label>

        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" size="lg" disabled={pending || !attestationChecked}>
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
        </div>
      </form>
    </Card>
  );
}
