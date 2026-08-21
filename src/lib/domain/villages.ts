/**
 * Canonical Saba village list.
 *
 * IMPORTANT: no canonical village list/type existed anywhere in the
 * codebase before the WhatsApp integration — `UserProfile.village` and
 * `WaterRequest.village` are (and remain) free-text `string` fields on
 * the web application, populated from an open text input with only a
 * placeholder example ("e.g. The Bottom"). This module was introduced
 * specifically because the WhatsApp conversation needs a deterministic,
 * numbered menu (see PRODUCT.md "WhatsApp Resident Ordering") — it does
 * NOT change the web form, the `UserProfile`/`WaterRequest` field types,
 * or any existing validation. A WhatsApp-selected village is written
 * into the same free-text `village: string` field as any web request.
 *
 * Flagged for a future product decision: the web request/profile forms
 * could later be migrated to this same canonical list for data-quality
 * consistency (e.g. village-demand statistics currently key on
 * whatever free text was typed), but that is an unrelated change and
 * was not made here.
 */
export const SABA_VILLAGES = [
  "The Bottom",
  "St. John's",
  "Windwardside",
  "Zion's Hill - Lower",
  "Zion's Hill - Upper",
] as const;

export type SabaVillage = (typeof SABA_VILLAGES)[number];

export function isValidSabaVillage(value: unknown): value is SabaVillage {
  return typeof value === "string" && (SABA_VILLAGES as readonly string[]).includes(value);
}
