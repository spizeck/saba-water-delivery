"use client";

import type {
  ReportedUrgency,
  VulnerableCircumstance,
  WaterSituationRemainingSupply,
} from "@/lib/domain/types";

/**
 * Shared "Your Water Situation" fields used by both the resident request
 * form and the dispatcher manual-request form (see PRODUCT.md "Resident
 * UX" / "Dispatcher Manual Requests" — staff must be able to capture the
 * exact same information a resident would). Kept as controlled string
 * state so it plugs into either form's existing local `useState` +
 * hidden-input submission pattern.
 */
export interface WaterSituationValue {
  remainingSupply: WaterSituationRemainingSupply | "";
  /** Kept as a string for controlled-input simplicity; parsed server-side. */
  personsAffected: string;
  availableStorageGallons: string;
  vulnerableCircumstances: VulnerableCircumstance[];
  vulnerableOtherDetail: string;
  reportedUrgency: ReportedUrgency | "";
}

export const EMPTY_WATER_SITUATION: WaterSituationValue = {
  remainingSupply: "",
  personsAffected: "",
  availableStorageGallons: "",
  vulnerableCircumstances: [],
  vulnerableOtherDetail: "",
  reportedUrgency: "",
};

export function isWaterSituationComplete(value: WaterSituationValue): boolean {
  if (!value.remainingSupply || !value.reportedUrgency) return false;
  if (value.vulnerableCircumstances.includes("other") && !value.vulnerableOtherDetail.trim()) {
    return false;
  }
  return true;
}

const REMAINING_SUPPLY_OPTIONS: { value: WaterSituationRemainingSupply; label: string }[] = [
  { value: "out", label: "Out of water" },
  { value: "less_than_1_day", label: "Less than 1 day remaining" },
  { value: "1_to_2_days", label: "1\u20132 days remaining" },
  { value: "more_than_2_days", label: "More than 2 days remaining" },
  { value: "unsure", label: "Not sure" },
];

const VULNERABLE_OPTIONS: { value: VulnerableCircumstance; label: string }[] = [
  { value: "elderly", label: "Elderly person" },
  { value: "infant_or_young_child", label: "Infant or young child" },
  { value: "medical_need", label: "Medical need" },
  { value: "essential_service", label: "Essential service or critical operation" },
  { value: "other", label: "Other critical circumstance" },
];

const URGENCY_OPTIONS: { value: ReportedUrgency; label: string; description: string }[] = [
  {
    value: "normal",
    label: "Normal",
    description: "I still have enough water for more than 2 days.",
  },
  {
    value: "urgent",
    label: "Urgent",
    description: "I expect to run out within 1\u20132 days.",
  },
  {
    value: "critical",
    label: "Critical",
    description:
      "I am out of water, expect to run out within 24 hours, or there are critical circumstances.",
  },
];

const STANDARD_LOAD_GALLONS = 1000;

interface Props {
  value: WaterSituationValue;
  onChange: (value: WaterSituationValue) => void;
  /**
   * Dispatcher-only: when a reported available-storage value is below
   * the standard delivery amount, allow staff to explicitly confirm it
   * is correct rather than being blocked outright (see PRODUCT.md
   * "Available Storage Capacity"). The resident-facing form omits this
   * — a resident-submitted value below 1,000 gallons is always treated
   * as a likely data-entry error.
   */
  allowBelowStandardCapacityOverride?: boolean;
  belowStandardCapacityConfirmed?: boolean;
  onBelowStandardCapacityConfirmedChange?: (confirmed: boolean) => void;
}

export function WaterSituationFields({
  value,
  onChange,
  allowBelowStandardCapacityOverride = false,
  belowStandardCapacityConfirmed = false,
  onBelowStandardCapacityConfirmedChange,
}: Props) {
  const storageNum = value.availableStorageGallons.trim()
    ? Number(value.availableStorageGallons)
    : null;
  const belowStandard =
    storageNum !== null && Number.isFinite(storageNum) && storageNum < STANDARD_LOAD_GALLONS;

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
        How much water do you have remaining?
        <select
          value={value.remainingSupply}
          onChange={(e) =>
            onChange({
              ...value,
              remainingSupply: e.target.value as WaterSituationRemainingSupply,
            })
          }
          required
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="" disabled>
            Select an option...
          </option>
          {REMAINING_SUPPLY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

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
        Available cistern/storage capacity (gallons, optional)
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={value.availableStorageGallons}
          onChange={(e) => onChange({ ...value, availableStorageGallons: e.target.value })}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        />
        <span className="text-xs font-normal text-slate-500">
          Each delivery is 1,000 gallons.
        </span>
      </label>

      {belowStandard && !allowBelowStandardCapacityOverride && (
        <p className="text-xs font-medium text-red-700">
          Available capacity is normally at least 1,000 gallons (the standard
          delivery amount). Please double-check this value.
        </p>
      )}
      {belowStandard && allowBelowStandardCapacityOverride && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <input
            type="checkbox"
            checked={belowStandardCapacityConfirmed}
            onChange={(e) => onBelowStandardCapacityConfirmedChange?.(e.target.checked)}
            className="mt-0.5"
          />
          This capacity is correct even though it is below the standard
          1,000-gallon delivery amount.
        </label>
      )}

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
        {value.vulnerableCircumstances.includes("other") && (
          <textarea
            value={value.vulnerableOtherDetail}
            onChange={(e) => onChange({ ...value, vulnerableOtherDetail: e.target.value })}
            rows={2}
            required
            placeholder="Briefly describe the circumstance (no medical details needed)"
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        )}
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
              onChange={() => onChange({ ...value, reportedUrgency: opt.value })}
              required
            />
            <span>
              <span className="font-medium text-slate-900">{opt.label}</span>
              <span className="block text-xs text-slate-500">{opt.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
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
      <input type="hidden" name="remainingSupply" value={value.remainingSupply} />
      <input type="hidden" name="personsAffected" value={value.personsAffected} />
      <input
        type="hidden"
        name="availableStorageGallons"
        value={value.availableStorageGallons}
      />
      <input type="hidden" name="vulnerableOtherDetail" value={value.vulnerableOtherDetail} />
      <input type="hidden" name="reportedUrgency" value={value.reportedUrgency} />
      {(value.vulnerableCircumstances.length > 0 ? value.vulnerableCircumstances : ["none"]).map(
        (c) => (
          <input key={c} type="hidden" name="vulnerableCircumstances" value={c} />
        ),
      )}
    </>
  );
}
