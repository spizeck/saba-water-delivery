import "server-only";

import type { VulnerableCircumstance } from "./types";
import type { WaterSituationInput } from "./waterRequests";

/**
 * Parses the "Your Water Situation" fields (see
 * `WaterSituationFields`/`WaterSituationHiddenFields` in
 * `src/components/forms/WaterSituationFields.tsx`) out of a submitted
 * `FormData`, shared by both the resident and dispatcher server actions
 * so the parsing logic — and therefore the resident-vs-staff validation
 * difference (see `confirmedBelowStandardCapacity`) — lives in exactly
 * one place.
 */
export function parseWaterSituationFromFormData(
  formData: FormData,
  options: { allowBelowStandardCapacityOverride?: boolean } = {},
): WaterSituationInput {
  const remainingSupply = String(
    formData.get("remainingSupply") ?? "",
  ) as WaterSituationInput["remainingSupply"];
  const reportedUrgency = String(
    formData.get("reportedUrgency") ?? "",
  ) as WaterSituationInput["reportedUrgency"];

  const personsAffectedRaw = String(formData.get("personsAffected") ?? "").trim();
  const personsAffected = personsAffectedRaw ? Number(personsAffectedRaw) : null;

  const availableStorageRaw = String(formData.get("availableStorageGallons") ?? "").trim();
  const availableStorageGallons = availableStorageRaw ? Number(availableStorageRaw) : null;

  const vulnerableCircumstances = formData
    .getAll("vulnerableCircumstances")
    .map((v) => String(v)) as VulnerableCircumstance[];

  const vulnerableOtherDetail = String(formData.get("vulnerableOtherDetail") ?? "").trim() || null;

  const confirmedBelowStandardCapacity = options.allowBelowStandardCapacityOverride
    ? formData.get("confirmedBelowStandardCapacity") === "true"
    : false;

  return {
    remainingSupply,
    personsAffected,
    vulnerableCircumstances,
    vulnerableOtherDetail,
    availableStorageGallons,
    reportedUrgency,
    confirmedBelowStandardCapacity,
  };
}
