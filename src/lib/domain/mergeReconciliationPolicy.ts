/**
 * Pure, dependency-free policy for durable account-merge Firebase Auth
 * reconciliation (issue #73).
 *
 * The Firestore account merge commits atomically, but Firebase Auth cleanup
 * cannot participate in that transaction — so convergence is honest
 * AT-LEAST-ONCE / idempotent, never claimed exactly-once. These functions hold
 * the retry schedule, failure classification, and state-transition decisions.
 * They are pure (no Firestore, no env, no wall clock — "now" and randomness
 * are injected) so the behavior is deterministically testable; the server-only
 * claim/act/record orchestration lives in `mergeReconciliation.ts`.
 *
 * Safety layering (see docs/adr/0018 and TECHNICAL.md):
 *   1. The merge transaction writes `users/{duplicateUid}.mergedIntoUserId`,
 *      which application authentication checks reject immediately — so access
 *      is blocked at commit time regardless of Auth state.
 *   2. Reconciliation then converges the Auth identity to its safe terminal
 *      state: disable → revoke refresh tokens → delete.
 *   3. `failed` is terminal for AUTOMATIC retry only; the merged-away identity
 *      stays rejected (and normally disabled) while an operator investigates.
 */

import type { MergeAuthReconciliationState } from "./types";

// --- Tunable policy constants ----------------------------------------------

/**
 * Maximum automatic reconciliation attempts before a transient failure
 * becomes terminal. The merged-away identity is already application-rejected
 * (and normally disabled) while pending, so a bounded horizon is safe — a
 * `failed` record is an operator-actionable terminal state, not an unsafe one.
 */
export const MERGE_AUTH_MAX_ATTEMPTS = 7;

/**
 * Delay (ms) applied AFTER the Nth failed attempt, before the next becomes
 * eligible: ~1m, 5m, 15m, 1h, 4h, 12h — total horizon ≈ 18h. Generous enough
 * to ride out a Firebase Auth outage without hammering the service.
 */
export const MERGE_AUTH_BACKOFF_SCHEDULE_MS = [
  60_000, // after attempt 1
  5 * 60_000, // after attempt 2
  15 * 60_000, // after attempt 3
  60 * 60_000, // after attempt 4
  4 * 60 * 60_000, // after attempt 5
  12 * 60 * 60_000, // after attempt 6
];

/** ±fraction of jitter applied to each backoff delay. */
export const MERGE_AUTH_BACKOFF_JITTER = 0.2;

/** How long a reconciler holds a processing lease before it may be reclaimed. */
export const MERGE_AUTH_LEASE_DURATION_MS = 5 * 60_000;

/** Maximum merge events a single sweep invocation will attempt to reconcile. */
export const MERGE_AUTH_WORKER_BATCH_LIMIT = 25;

/**
 * Read budget (documents examined, not claims) for the sweep's
 * legacy-discovery scan — the bounded `createdAt`-ordered scan of unresolved
 * records that surfaces pre-#73 events which have no `authReconciliation`
 * sub-record (missing fields can never match a `state` query). Every record
 * written since #73 carries the sub-record inside the merge transaction, so
 * all legacy records sort before every modern unresolved record; the scan
 * therefore finds them in its first page and modern ineligible records can
 * never starve it.
 */
export const MERGE_AUTH_LEGACY_SCAN_LIMIT = 100;

/**
 * After this age an unresolved (`pending`/`processing`) reconciliation is
 * operationally stale and surfaced in diagnostics/operator views.
 */
export const MERGE_AUTH_STALE_MS = 24 * 60 * 60_000;

// --- Failure classification -------------------------------------------------

/**
 * Sanitized failure categories (never a raw provider error/body). Retryable
 * vs terminal is decided by {@link isRetryableMergeAuthCategory}.
 */
export type MergeAuthFailureCategory =
  | "transient" // network/5xx/unknown Auth service failure — retry
  | "permission" // Admin SDK lacks IAM permission for Auth — terminal
  | "configuration" // Admin not configured / bad credentials — terminal
  | "invalid_record" // merge record itself is malformed — terminal
  | "max_attempts"; // retried to the cap and still failing — terminal

/** Whether a failure category is transient (eligible for automatic retry). */
export function isRetryableMergeAuthCategory(
  category: MergeAuthFailureCategory,
): boolean {
  return category === "transient";
}

/**
 * Stable `code` values from `FirebaseAuthError` / `FirebaseAppError` that a
 * retry cannot fix — the Admin service account needs an IAM/permissions fix.
 */
const PERMISSION_AUTH_ERROR_CODES = new Set(["auth/insufficient-permission"]);

/** Codes (and config absence) meaning the Admin SDK cannot reach Auth at all. */
const CONFIGURATION_AUTH_ERROR_CODES = new Set([
  "auth/invalid-credential",
  "auth/configuration-not-found",
  "auth/project-not-found",
]);

/** The recorded duplicate uid is not a valid Auth uid — the record is bad. */
const RECORD_AUTH_ERROR_CODES = new Set(["auth/invalid-uid"]);

/** `getAdminAuth()` throws this when env config is absent (deployed envs fail
 * closed at isFirebaseAdminConfigured, but the check here keeps the domain
 * layer honest if a caller bypasses it). */
const ADMIN_NOT_CONFIGURED_MARKER = "Firebase Admin is not configured";

/**
 * Classifies a Firebase Admin Auth failure into a sanitized category. Unknown
 * codes (network errors, `app/network-error`, 5xx, future provider errors)
 * are treated as transient so a new failure mode is retried rather than
 * silently abandoned — bounded by {@link MERGE_AUTH_MAX_ATTEMPTS}.
 * `auth/user-not-found` never reaches this function: it is the idempotent
 * success signal and is handled by the caller.
 */
export function classifyMergeAuthError(
  error: unknown,
): MergeAuthFailureCategory {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? (error as { code: string }).code
      : "";
  const message = error instanceof Error ? error.message : "";

  if (RECORD_AUTH_ERROR_CODES.has(code)) {
    return "invalid_record";
  }
  if (PERMISSION_AUTH_ERROR_CODES.has(code)) {
    return "permission";
  }
  if (
    CONFIGURATION_AUTH_ERROR_CODES.has(code) ||
    message.includes(ADMIN_NOT_CONFIGURED_MARKER)
  ) {
    return "configuration";
  }
  return "transient";
}

// --- State decisions --------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Backoff delay (ms) to apply after `attemptCount` failed attempts. `rng` is
 * injected for deterministic tests (default `Math.random`); pass `() => 0.5`
 * for zero jitter. `attemptCount` is 1-based.
 */
export function computeMergeAuthBackoffMs(
  attemptCount: number,
  rng: () => number = Math.random,
): number {
  const idx = clamp(
    attemptCount - 1,
    0,
    MERGE_AUTH_BACKOFF_SCHEDULE_MS.length - 1,
  );
  const base = MERGE_AUTH_BACKOFF_SCHEDULE_MS[idx];
  const jitter = base * MERGE_AUTH_BACKOFF_JITTER * (rng() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export interface MergeAuthFailureDecision {
  state: Extract<MergeAuthReconciliationState, "pending" | "failed">;
  category: MergeAuthFailureCategory;
  /** Backoff delay to schedule when `state === "pending"`. */
  retryDelayMs?: number;
}

/**
 * Decides the next state after a failed reconciliation attempt. Transient
 * failures retry with backoff until the attempt cap, then become a terminal
 * `max_attempts` failure; every non-transient category is terminal
 * immediately. A terminal record stays operator-visible and manually
 * retryable — and the merged-away identity remains application-rejected, so
 * terminal-for-retry is never terminal-for-security.
 *
 * @param attemptCount attempts made so far INCLUDING the one that just failed
 */
export function decideAfterMergeAuthFailure(
  attemptCount: number,
  category: MergeAuthFailureCategory,
  rng: () => number = Math.random,
): MergeAuthFailureDecision {
  if (!isRetryableMergeAuthCategory(category)) {
    return { state: "failed", category };
  }
  if (attemptCount >= MERGE_AUTH_MAX_ATTEMPTS) {
    return { state: "failed", category: "max_attempts" };
  }
  return {
    state: "pending",
    category,
    retryDelayMs: computeMergeAuthBackoffMs(attemptCount, rng),
  };
}
