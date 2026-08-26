/**
 * Pure resident-identity matching logic for dispatcher duplicate detection
 * and admin linking/merge workflows.
 *
 * This module intentionally does NOT access Firestore — it operates on
 * already-fetched directory entries and form inputs so it is unit testable
 * without a database. The server-side callers live in
 * `src/lib/domain/identity.ts`.
 *
 * Matching is deliberately conservative: a normalized email match is the
 * only "strong" signal; phone matches are treated as a weaker signal
 * because phones are shared, reassigned, and reused; name alone is never
 * used to auto-link identities.
 */

import type { ResidentDirectoryEntry } from "./users";
import type { UserRole } from "./types";

export type IdentityMatchStrength = "strong" | "medium" | "weak";

export interface ResidentIdentityMatch {
  resident: ResidentDirectoryEntry;
  strength: IdentityMatchStrength;
  /** Which fields contributed to the match (email is always strong). */
  matchedOn: Array<"email" | "phone" | "name">;
}

/**
 * Normalizes a phone number for comparison by stripping everything except
 * digits. Reuses the same convention as WhatsApp matching
 * (`src/lib/whatsapp/phoneMatching.ts`) so dispatcher, admin, and WhatsApp
 * identity checks behave consistently.
 */
export function normalizePhoneForMatching(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Normalizes an email address for comparison: lowercase, trimmed.
 * Email is the only strong identity signal because it is unique within
 * Firebase Authentication for this project.
 */
export function normalizeEmailForMatching(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Simple name-similarity helper. Treats names as similar when one
 * normalized form contains the other, or they are equal. This is
 * intentionally basic — it supports small typos/whitespace/transposition
 * at a glance but is not a fuzzy-string library, per DEVIN.md "Do Not
 * Overbuild". It is only used as a supporting signal, never as a basis
 * for automatic linking.
 */
export function namesLookSimilar(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < 4 || nb.length < 4) return false;
  return na.includes(nb) || nb.includes(na);
}

export interface IdentityMatchInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Finds residents in the directory that match the supplied identity clues.
 *
 * Rules (applied per resident, in priority order):
 *   1. Strong — exact normalized email match (regardless of name/phone).
 *   2. Medium — exact normalized phone match. If the name is also
 *      similar, `matchedOn` includes "name" for context, but the
 *      strength remains "medium" because phone sharing is common.
 *   3. Weak — name similarity only (no matching contact).
 *
 * Multiple residents may be returned (e.g. a phone number shared by
 * household members). Callers must never treat a phone match as proof
 * of a single identity.
 */
export function findIdentityMatches(
  input: IdentityMatchInput,
  directory: ResidentDirectoryEntry[],
): ResidentIdentityMatch[] {
  const inputEmail = normalizeEmailForMatching(input.email);
  const inputPhone = normalizePhoneForMatching(input.phone);
  const inputName = (input.name ?? "").trim();

  const matches: ResidentIdentityMatch[] = [];

  for (const resident of directory) {
    const residentEmail = normalizeEmailForMatching(resident.email);
    const residentPhone = normalizePhoneForMatching(resident.phone);

    const emailMatch = Boolean(inputEmail && residentEmail && inputEmail === residentEmail);
    const phoneMatch = Boolean(inputPhone && residentPhone && inputPhone === residentPhone);
    const nameMatch = Boolean(
      inputName && resident.displayName && namesLookSimilar(inputName, resident.displayName),
    );

    if (emailMatch) {
      const matchedOn: Array<"email" | "phone" | "name"> = ["email"];
      if (phoneMatch) matchedOn.push("phone");
      if (nameMatch) matchedOn.push("name");
      matches.push({ resident, strength: "strong", matchedOn });
      continue;
    }

    if (phoneMatch) {
      const matchedOn: Array<"email" | "phone" | "name"> = ["phone"];
      if (nameMatch) matchedOn.push("name");
      matches.push({ resident, strength: "medium", matchedOn });
      continue;
    }

    if (nameMatch) {
      matches.push({ resident, strength: "weak", matchedOn: ["name"] });
    }
  }

  return matches;
}

/**
 * Convenience: returns the single strong email match, or null if none.
 * Because Firebase Authentication enforces one account per email, there
 * should be at most one strong match in the resident directory.
 */
export function findStrongEmailMatch(
  input: IdentityMatchInput,
  directory: ResidentDirectoryEntry[],
): ResidentIdentityMatch | null {
  return (
    findIdentityMatches(input, directory).find((m) => m.strength === "strong" && m.matchedOn.includes("email")) ??
    null
  );
}

/**
 * Convenience: returns phone matches only (medium strength), excluding
 * the stronger email match if one exists. Useful for showing "possible
 * existing resident" candidates without mixing in the definitive email
 * match.
 */
export function findPhoneMatches(
  input: IdentityMatchInput,
  directory: ResidentDirectoryEntry[],
): ResidentIdentityMatch[] {
  return findIdentityMatches(input, directory).filter(
    (m) => m.matchedOn.includes("phone") && !m.matchedOn.includes("email"),
  );
}

/**
 * Builds the default "safe union" role set for account merges: unions
 * non-sensitive roles (resident, viewer) and deliberately excludes
 * system-managed/sensitive roles (admin, dispatcher, driver) unless
 * an admin explicitly opts into transferring them via the explicit
 * role merge policy.
 */
export function buildDefaultUnionRoles(
  rolesA: readonly UserRole[],
  rolesB: readonly UserRole[],
): UserRole[] {
  const sensitive: UserRole[] = ["admin", "dispatcher", "driver"];
  const union = new Set<UserRole>([...rolesA, ...rolesB]);
  return Array.from(union)
    .filter((r) => !sensitive.includes(r))
    .sort();
}
