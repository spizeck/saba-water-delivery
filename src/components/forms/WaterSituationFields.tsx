"use client";

import type { ReportedUrgency, VulnerableCircumstance } from "@/lib/domain/types";

/**
 * Shared "Your Water Situation" fields used by both the resident request
 * form and the dispatcher manual-request form (see PRODUCT.md "Resident
 * UX" / "Dispatcher Manual Requests" — staff must be able to capture the
 * exact same information a resident would). Kept as controlled string
 * state so it plugs into either form's existing local `useState` +
 * hidden-input submission pattern.
 */
export interface WaterSituationValue {
  /** Kept as a string for controlled-input simplicity; parsed server-side. */
  personsAffected: string;
  /** Free-form text describing available cistern/storage capacity. */
  availableStorageCapacity: string;
  vulnerableCircumstances: VulnerableCircumstance[];
  reportedUrgency: ReportedUrgency | "";
  /** Required explanation shown/collected only when `reportedUrgency === "critical"`. */
  criticalExplanation: string;
}

export const EMPTY_WATER_SITUATION: WaterSituationValue = {
  personsAffected: "",
  availableStorageCapacity: "",
  vulnerableCircumstances: [],
  reportedUrgency: "",
  criticalExplanation: "",
};

export function isWaterSituationComplete(value: WaterSituationValue): boolean {
  if (!value.reportedUrgency) return false;
  if (value.reportedUrgency === "critical") return value.criticalExplanation.trim().length > 0;
  return true;
}

const VULNERABLE_OPTIONS: { value: VulnerableCircumstance; label: string }[] = [
  { value: "elderly", label: "Elderly person" },
  { value: "infant_or_young_child", label: "Infant or young child" },
  { value: "medical_need", label: "Medical need" },
  { value: "essential_services_commercial_business", label: "Essential services (Commercial/business)" },
  { value: "hotel_or_restaurant", label: "Hotel or Restaurant" },
];

/**
 * Resident-facing urgency choices — deliberately just Normal/Critical
 * (no explanatory supply estimate) after government testing found the
 * three-way Normal/Urgent/Critical choice, and the days/feet/water-
 * remaining explanations, caused subjective debate. See PRODUCT.md
 * "Resident-Reported Urgency" / "Critical Explanation".
 */
const URGENCY_OPTIONS: { value: ReportedUrgency; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "critical", label: "Critical" },
];

interface Props {
  value: WaterSituationValue;
  onChange: (value: WaterSituationValue) => void;
}

export function WaterSituationFields({ value, onChange }: Props) {
  function toggleVulnerable(option: VulnerableCircumstance) {
    const has = value.vulnerableCircumstances.includes(option);
    let next: VulnerableCircumstance[];
    if (option === "none") {
      next = has ? [] : ["none"];
    } else {
      const withoutNone = value.vulnerableCircumstances.filter((c) => c !== "none");
      next = has ? withoutNone.filter((c) => c !== option) : [...withoutNone, option];
    }
    onChange({ ...value, vulnerableCircumstances: next });
  }

  const noneSelected =
    value.vulnerableCircumstances.length === 0 || value.vulnerableCircumstances.includes("none");

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-bold text-slate-900">Your Water Situation</p>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        How many people rely on this water? (optional)
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={value.personsAffected}
          onChange={(e) => onChange({ ...value, personsAffected: e.target.value })}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Available cistern/storage capacity
        <input
          type="text"
          value={value.availableStorageCapacity}
          onChange={(e) => onChange({ ...value, availableStorageCapacity: e.target.value })}
          placeholder="e.g. 1500, About 2,000 gallons, Unknown"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
        />
        <span className="text-xs font-normal text-slate-500">
          Each load is 1,000 gallons. Enter a description or estimate.
        </span>
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-slate-700">
          Are there vulnerable persons or critical circumstances?
        </legend>
        {VULNERABLE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={value.vulnerableCircumstances.includes(opt.value)}
              onChange={() => toggleVulnerable(opt.value)}
            />
            {opt.label}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={noneSelected} onChange={() => toggleVulnerable("none")} />
          None of these
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-slate-700">How urgent is your request?</legend>
        {URGENCY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
          >
            <input
              type="radio"
              name="reportedUrgencyChoice"
              className="mt-0.5"
              checked={value.reportedUrgency === opt.value}
              onChange={() =>
                onChange({
                  ...value,
                  reportedUrgency: opt.value,
                  // Never retain stale Critical explanation text if the
                  // resident switches back to Normal before submitting.
                  criticalExplanation: opt.value === "critical" ? value.criticalExplanation : "",
                })
              }
              required
            />
            <span className="font-medium text-slate-900">{opt.label}</span>
          </label>
        ))}
      </fieldset>

      {value.reportedUrgency === "critical" && (
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Please explain why this request is critical.
          <textarea
            value={value.criticalExplanation}
            onChange={(e) => onChange({ ...value, criticalExplanation: e.target.value })}
            rows={3}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>
      )}
    </div>
  );
}

/** Hidden-input serialization for a form submission — pairs with
 * `WaterSituationValue` above so callers don't have to repeat the field
 * names. `vulnerableCircumstances` uses repeated inputs of the same
 * name so the server can read them with `formData.getAll(...)`. */
export function WaterSituationHiddenFields({ value }: { value: WaterSituationValue }) {
  return (
    <>
      <input type="hidden" name="personsAffected" value={value.personsAffected} />
      <input type="hidden" name="availableStorageCapacity" value={value.availableStorageCapacity} />
      <input type="hidden" name="reportedUrgency" value={value.reportedUrgency} />
      <input
        type="hidden"
        name="criticalExplanation"
        value={value.reportedUrgency === "critical" ? value.criticalExplanation : ""}
      />
      {(value.vulnerableCircumstances.length > 0 ? value.vulnerableCircumstances : ["none"]).map(
        (c) => (
          <input key={c} type="hidden" name="vulnerableCircumstances" value={c} />
        ),
      )}
    </>
  );
}
