import "server-only";

import type { VulnerableCircumstance } from "./types";
import type { WaterSituationInput } from "./waterRequests";

/**
 * Parses the "Your Water Situation" fields (see
 * `WaterSituationFields`/`WaterSituationHiddenFields` in
 * `src/components/forms/WaterSituationFields.tsx`) out of a submitted
 * `FormData`, shared by both the resident and dispatcher server actions
 * so the parsing logic lives in exactly one place.
 *
 * The remaining-water question was removed in the government-requested
 * form refinement; `availableStorageCapacity` is now free-form text rather
 * than a numeric gallon value.
 */
export function parseWaterSituationFromFormData(
  formData: FormData,
): WaterSituationInput {
  const reportedUrgency = String(
    formData.get("reportedUrgency") ?? "",
  ) as WaterSituationInput["reportedUrgency"];

  const personsAffectedRaw = String(formData.get("personsAffected") ?? "").trim();
  const personsAffected = personsAffectedRaw ? Number(personsAffectedRaw) : null;

  const availableStorageCapacity =
    String(formData.get("availableStorageCapacity") ?? "").trim() || null;

  const criticalExplanation = String(formData.get("criticalExplanation") ?? "").trim() || null;

  const vulnerableCircumstances = formData
    .getAll("vulnerableCircumstances")
    .map((v) => String(v)) as VulnerableCircumstance[];

  return {
    personsAffected,
    vulnerableCircumstances,
    availableStorageCapacity,
    reportedUrgency,
    criticalExplanation,
  };
}
