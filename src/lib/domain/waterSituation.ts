/**
 * Pure water-situation validation/normalization logic, factored out of
 * `waterRequests.ts` (which has a `server-only` guard and Firestore
 * dependencies) so it can be unit tested directly — same pattern as
 * `dispatchSelection.ts` for `dispatch.ts`.
 */

import type { ReportedUrgency, VulnerableCircumstance, WaterSituationSnapshot } from "./types";

/**
 * Caller-supplied water-situation answers. See PRODUCT.md "Additional
 * Water Request Information". This is the raw form input; the stable,
 * immutable `WaterSituationSnapshot` stored on the request is derived
 * from this in `buildWaterSituationSnapshot()` below.
 */
export interface WaterSituationInput {
  /** Positive integer, or null if not provided (e.g. caller unsure). */
  personsAffected?: number | null;
  vulnerableCircumstances?: VulnerableCircumstance[];
  /** Resident-reported available cistern/storage capacity, as free-form text. */
  availableStorageCapacity?: string | null;
  reportedUrgency: ReportedUrgency;
  /** Required when `reportedUrgency === "critical"`; ignored/discarded
   * otherwise (see `buildWaterSituationSnapshot`). */
  criticalExplanation?: string | null;
}

/**
 * Validates and normalizes raw water-situation form input into the
 * stable snapshot shape stored on the request. Throws a specific error
 * code (see callers for user-facing messages) rather than silently
 * coercing bad input.
 */
export function buildWaterSituationSnapshot(
  input: WaterSituationInput,
): WaterSituationSnapshot {
  const vulnerableCircumstances = input.vulnerableCircumstances?.length
    ? input.vulnerableCircumstances
    : (["none"] as VulnerableCircumstance[]);

  if (input.personsAffected != null) {
    if (!Number.isInteger(input.personsAffected) || input.personsAffected <= 0) {
      throw new Error("INVALID_PERSONS_AFFECTED");
    }
  }

  const availableStorageCapacity = input.availableStorageCapacity?.trim() || null;

  // Critical requires a required, non-blank written explanation (see
  // PRODUCT.md "Critical Explanation") — trim whitespace before
  // validating so a whitespace-only value cannot pass. For any other
  // urgency, the explanation is discarded (never retained as stale
  // text if the resident switches back to Normal before submitting).
  let criticalExplanation: string | null = null;
  if (input.reportedUrgency === "critical") {
    const trimmed = input.criticalExplanation?.trim() || "";
    if (!trimmed) {
      throw new Error("CRITICAL_EXPLANATION_REQUIRED");
    }
    criticalExplanation = trimmed;
  }

  return {
    personsAffected: input.personsAffected ?? null,
    vulnerableCircumstances,
    availableStorageCapacity,
    reportedUrgency: input.reportedUrgency,
    criticalExplanation,
  };
}
