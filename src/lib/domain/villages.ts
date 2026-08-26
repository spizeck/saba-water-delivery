/**
 * Canonical Saba village list.
 *
 * All village entry points (resident profile, dispatcher manual request,
 * and the WhatsApp resident ordering conversation) now draw from this
 * single list. Server-side validation rejects any village value that is
 * not one of the approved strings. This list is also the source of truth
 * for village-demand statistics.
 *
 * The approved names and spelling are the government-agreed canonical
 * values. Do not add fuzzy matching or alternate spellings.
 */
export const SABA_VILLAGES = [
  "St Johns",
  "The Bottom",
  "Windwardside",
  "Zions Hill - Lower",
  "Zions Hill - Upper",
] as const;

export type SabaVillage = (typeof SABA_VILLAGES)[number];

export function isValidSabaVillage(value: unknown): value is SabaVillage {
  return typeof value === "string" && (SABA_VILLAGES as readonly string[]).includes(value);
}
