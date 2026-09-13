/**
 * Pure, dependency-free configuration validators (issue #54).
 *
 * Each validator takes a variable NAME and its RAW string value (or undefined)
 * and returns a parsed/normalized result — or throws a {@link ConfigError} whose
 * message contains only the name and a categorical reason, never the value.
 *
 * These functions are intentionally pure: they never read `process.env`
 * themselves, so they can be unit-tested deterministically without depending on
 * the machine's shell environment (a requirement of #54 — tests must not pass
 * merely because the developer's shell happens to be configured). The modules
 * that actually own configuration (`serverConfig.ts`, `appOrigin.ts`,
 * `deployment.ts`) read the environment and delegate here for validation.
 *
 * A "lightweight internal validator" is used deliberately instead of a large
 * runtime schema dependency (see docs/adr/0016) — the value it would add over
 * these small functions does not justify the bundle/maintenance cost.
 */
import { ConfigError } from "./errors";

/** True when a raw env value is present and non-empty after trimming. */
export function isPresent(raw: string | undefined | null): raw is string {
  return typeof raw === "string" && raw.trim().length > 0;
}

/** Required non-empty string. Throws (value-free) when missing/blank. */
export function requiredString(name: string, raw: string | undefined): string {
  if (!isPresent(raw)) {
    throw new ConfigError(name, "required but missing or empty");
  }
  return raw.trim();
}

/** Optional string — returns the trimmed value, or undefined when absent. */
export function optionalString(
  name: string,
  raw: string | undefined,
): string | undefined {
  return isPresent(raw) ? raw.trim() : undefined;
}

/**
 * Required secret. Same shape as {@link requiredString} but named to make the
 * intent explicit at call sites and to guarantee the value never reaches the
 * error message.
 */
export function requiredSecret(name: string, raw: string | undefined): string {
  if (!isPresent(raw)) {
    throw new ConfigError(name, "required secret is missing or empty");
  }
  return raw.trim();
}

/**
 * Parses/normalizes an absolute http(s) URL to its origin with no trailing
 * slash (e.g. `https://example.gov/` -> `https://example.gov`). Rejects
 * non-absolute or non-http(s) values. The malformed value is never echoed.
 */
export function parseHttpUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(name, "must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(name, "must use http or https");
  }
  // Normalize to origin (drop any path/query/hash and trailing slash).
  return url.origin;
}

/** Required http(s) URL (origin-normalized). */
export function requiredHttpUrl(name: string, raw: string | undefined): string {
  return parseHttpUrl(name, requiredString(name, raw));
}

/** Optional http(s) URL (origin-normalized) — undefined when absent. */
export function optionalHttpUrl(
  name: string,
  raw: string | undefined,
): string | undefined {
  const value = optionalString(name, raw);
  return value === undefined ? undefined : parseHttpUrl(name, value);
}

/**
 * A boolean rollout/flag value. Absent, empty, or the literal string "false"
 * (case-insensitive) is `false`; any other non-empty value is `true`. Mirrors
 * the existing `CSP_REPORT_ONLY` semantics (`headers.ts`). Never throws.
 */
export function booleanFlag(raw: string | undefined): boolean {
  if (!isPresent(raw)) return false;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Parses a comma-separated list into trimmed, non-empty entries (e.g. an email
 * recipient list). Returns [] when absent/blank. Never throws — emptiness is a
 * signal the caller interprets (an integration may treat [] as "not
 * configured").
 */
export function csvList(raw: string | undefined): string[] {
  if (!isPresent(raw)) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Validates an optional Firestore database id. Firestore database ids are
 * `(default)` or 4–63 chars of lowercase letters/digits/hyphens, starting with
 * a letter and not ending with a hyphen. Returns undefined when absent (meaning
 * "use the project's (default) database" — see firebase/admin.ts). Throws
 * (value-free) when a present value is not a legal id, so a typo cannot silently
 * point the trusted server at the wrong/nonexistent database.
 */
export function optionalDatabaseId(
  name: string,
  raw: string | undefined,
): string | undefined {
  const value = optionalString(name, raw);
  if (value === undefined) return undefined;
  if (value === "(default)") return value;
  const ok = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(value);
  if (!ok) {
    throw new ConfigError(
      name,
      "must be '(default)' or a valid Firestore database id " +
        "(lowercase letters, digits, hyphens; 4–63 chars)",
    );
  }
  return value;
}

/**
 * Lightweight sanity check that a value looks like an email address (contains a
 * single `@` with non-empty local and domain parts and a dot in the domain).
 * Not RFC-complete — just enough to catch an obviously wrong `CLIENT_EMAIL` /
 * sender address early, with a value-free error.
 */
export function requiredEmail(name: string, raw: string | undefined): string {
  const value = requiredString(name, raw);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (!ok) {
    throw new ConfigError(name, "must be a valid email address");
  }
  return value;
}

/**
 * Validates that a value looks like a PEM private key (contains the
 * `BEGIN PRIVATE KEY` marker after `\n`-unescaping). Returns the unescaped key.
 * The key material is NEVER included in the error. Used for
 * `FIREBASE_ADMIN_PRIVATE_KEY`, which is stored with literal `\n` sequences.
 */
export function requiredPrivateKey(
  name: string,
  raw: string | undefined,
): string {
  const value = requiredSecret(name, raw);
  const unescaped = value.replace(/\\n/g, "\n");
  if (!unescaped.includes("BEGIN") || !unescaped.includes("PRIVATE KEY")) {
    throw new ConfigError(
      name,
      "does not look like a PEM private key (missing BEGIN PRIVATE KEY marker)",
    );
  }
  return unescaped;
}
