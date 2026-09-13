/**
 * Pure, dependency-free policy for the durable notification outbox (issue #53).
 *
 * These functions and constants contain the retry/backoff schedule, the failure
 * classification, and the state-transition decisions. They are pure (no
 * Firestore, no `process.env`, no wall clock — "now" and randomness are injected)
 * so the retry/idempotency behavior is deterministically testable without the
 * emulator. The server-only orchestration lives in `outbox.ts` / `worker.ts`.
 *
 * Delivery guarantee (documented honestly — see docs/adr/0017):
 *   - AT-LEAST-ONCE processing: a notification is retried until it is sent or
 *     reaches a terminal state.
 *   - Provider-level de-duplication: every attempt for one logical notification
 *     reuses the SAME deterministic provider idempotency key, so Resend collapses
 *     duplicates within its idempotency window.
 *   - NOT exactly-once: the crash window between provider acceptance and the
 *     local `sent` write is covered by that provider key, but only within the
 *     provider window. The total retry horizon is kept below that window.
 */

/** Notification kinds that use the durable outbox. Delivery confirmation is the
 * only one today; the model is intentionally extensible (see the ADR). */
export type NotificationType = "delivery_confirmation_email";

/**
 * Outbox state machine:
 *   - `pending`    — awaiting its next attempt; eligible when nextAttemptAt<=now.
 *   - `processing` — leased by a worker (leaseOwner/leaseExpiresAt); a send is in
 *                    flight. Reclaimable ONLY once the lease has expired.
 *   - `sent`       — terminal success; never intentionally resent.
 *   - `failed`     — terminal; not auto-retried. Only an explicit admin manual
 *                    retry returns it to `pending`.
 */
export type NotificationState = "pending" | "processing" | "sent" | "failed";

/**
 * Sanitized failure categories (never a raw provider body). Retryable vs
 * terminal is decided by {@link isRetryableCategory}.
 */
export type FailureCategory =
  | "transient" // network / 5xx / rate-limit — retry
  | "permanent" // provider rejected the message (e.g. bad address) — terminal
  | "configuration_disabled" // Resend not configured — terminal until fixed
  | "recipient_ineligible" // registered resident not claimed / no email — terminal
  | "max_attempts"; // retried up to the cap and still failing — terminal

// --- Tunable policy constants ----------------------------------------------

/** Maximum automatic send attempts before a transient failure becomes terminal. */
export const MAX_ATTEMPTS = 6;

/**
 * Delay (ms) applied AFTER the Nth failed attempt, before the next becomes
 * eligible: ~1m, 5m, 15m, 1h, 3h, then capped. The full horizon (~4.3h) is
 * deliberately kept well under Resend's idempotency window (~24h) so the
 * provider still de-duplicates a retry after a provider-accept/local-crash gap.
 */
export const BACKOFF_SCHEDULE_MS = [
  60_000, // after attempt 1
  5 * 60_000, // after attempt 2
  15 * 60_000, // after attempt 3
  60 * 60_000, // after attempt 4
  3 * 60 * 60_000, // after attempt 5
];

/** ±fraction of jitter applied to each backoff delay to avoid thundering herds. */
export const BACKOFF_JITTER_FRACTION = 0.2;

/** How long a worker holds a processing lease before it may be reclaimed. */
export const LEASE_DURATION_MS = 5 * 60_000;

/** Maximum notifications a single worker invocation will process. */
export const WORKER_BATCH_LIMIT = 25;

/** Resend's documented idempotency window (informational; see the ADR). */
export const PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000;

// --- Pure helpers ----------------------------------------------------------

/** Deterministic outbox document id for a logical notification. Stable across
 * retries and re-invocations, so repeated processing addresses the same doc. */
export function outboxIdFor(type: NotificationType, requestId: string): string {
  return `${type}__${requestId}`;
}

/** Deterministic provider idempotency key. MUST stay stable for the logical
 * notification so Resend de-duplicates retries (kept identical to the value the
 * pre-outbox code used, so historical/in-flight keys are unchanged). */
export function providerIdempotencyKeyFor(requestId: string): string {
  return `delivery-confirmation-${requestId}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Backoff delay (ms) to apply after `attemptCount` failed attempts. `rng` is
 * injected for deterministic tests (default `Math.random`); pass `() => 0.5` for
 * zero jitter. `attemptCount` is 1-based (1 = the first attempt just failed).
 */
export function computeBackoffMs(
  attemptCount: number,
  rng: () => number = Math.random,
): number {
  const idx = clamp(attemptCount - 1, 0, BACKOFF_SCHEDULE_MS.length - 1);
  const base = BACKOFF_SCHEDULE_MS[idx];
  // Map rng() in [0,1) to [-1, 1) then scale by the jitter fraction.
  const jitter = base * BACKOFF_JITTER_FRACTION * (rng() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/** Whether a failure category is transient (eligible for automatic retry). */
export function isRetryableCategory(category: FailureCategory): boolean {
  return category === "transient";
}

/**
 * Classifies a Resend error by its stable `name` (never the message body).
 * Unknown names are treated as transient (retry, bounded by MAX_ATTEMPTS) so a
 * new provider error never becomes silently permanent. The explicit permanent
 * set is provider input errors that retrying cannot fix.
 */
const PERMANENT_RESEND_ERROR_NAMES = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_attachment",
  "invalid_parameter",
]);

export function classifyResendError(
  errorName: string | null | undefined,
): FailureCategory {
  if (errorName && PERMANENT_RESEND_ERROR_NAMES.has(errorName)) {
    return "permanent";
  }
  return "transient";
}

/**
 * Result of attempting to send one notification. `reason` is a short sanitized
 * category/code (never a provider body, address, token, or secret).
 */
export type SendOutcome =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; category: FailureCategory; reason: string };

export interface FailureDecision {
  state: Extract<NotificationState, "pending" | "failed">;
  category: FailureCategory;
  /** Backoff delay to schedule when `state === "pending"`. */
  retryDelayMs?: number;
}

/**
 * Decides the next state after a failed send attempt. Transient failures retry
 * with backoff until the attempt cap is reached, at which point they become a
 * terminal `max_attempts` failure. Every non-transient category is terminal
 * immediately.
 *
 * @param attemptCount attempts made so far INCLUDING the one that just failed
 */
export function decideAfterFailure(
  attemptCount: number,
  category: FailureCategory,
  rng: () => number = Math.random,
): FailureDecision {
  if (!isRetryableCategory(category)) {
    return { state: "failed", category };
  }
  if (attemptCount >= MAX_ATTEMPTS) {
    return { state: "failed", category: "max_attempts" };
  }
  return {
    state: "pending",
    category,
    retryDelayMs: computeBackoffMs(attemptCount, rng),
  };
}
