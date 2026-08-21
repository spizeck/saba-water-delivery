/**
 * Pure resident-identity matching logic for the WhatsApp conversation —
 * see PRODUCT.md "Resident Identity Strategy". No Firestore access, no
 * `server-only` guard, so it is unit testable directly (same pattern
 * as `dispatchSelection.ts` / `continuityReportData.ts`); the
 * server-only wrapper that actually fetches the resident directory is
 * `residentMatch.ts`.
 *
 * A matching phone number is deliberately NOT treated as proof of
 * identity by itself — see the three-way result type below. This
 * mirrors the existing dispatcher soft-duplicate phone matching
 * (`findActiveRequestsByPhone`), applied here to identity instead of
 * duplicate detection.
 */

import type { ResidentDirectoryEntry } from "@/lib/domain/users";

/**
 * Normalizes a phone number for comparison by stripping everything but
 * digits. WhatsApp delivers sender numbers in bare E.164-ish digit form
 * (e.g. "5994165363"); saved profile phones may be formatted many ways
 * (e.g. "+599 416 5363", "599-416-5363"). Comparing digits-only avoids
 * false negatives from formatting differences, and is intentionally
 * simple — no country-code-aware parsing library, per DEVIN.md "Do Not
 * Overbuild".
 */
export function normalizePhoneForMatching(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export type ResidentPhoneMatch =
  | { type: "unique"; resident: ResidentDirectoryEntry }
  | { type: "none" }
  | { type: "ambiguous" };

/**
 * Matches a raw phone number against an already-fetched resident
 * directory. Deterministic:
 *   - Exactly one normalized match -> "unique" (treat as that resident).
 *   - Zero matches -> "none" (proceed as an unregistered customer).
 *   - More than one match -> "ambiguous" (never guess — see PRODUCT.md
 *     "Resident Identity Strategy").
 */
export function matchResidentByPhoneFromDirectory(
  rawPhone: string,
  directory: ResidentDirectoryEntry[],
): ResidentPhoneMatch {
  const normalized = normalizePhoneForMatching(rawPhone);
  if (!normalized) return { type: "none" };

  const matches = directory.filter(
    (entry) => normalizePhoneForMatching(entry.phone) === normalized,
  );

  if (matches.length === 0) return { type: "none" };
  if (matches.length > 1) return { type: "ambiguous" };
  return { type: "unique", resident: matches[0] };
}
