import { describe, expect, it } from "vitest";

import {
  BACKOFF_SCHEDULE_MS,
  MAX_ATTEMPTS,
  classifyResendError,
  computeBackoffMs,
  decideAfterFailure,
  isRetryableCategory,
  outboxIdFor,
  providerIdempotencyKeyFor,
} from "../outboxPolicy";

/**
 * Pure retry/idempotency policy tests (issue #53). Deterministic — "now" and
 * randomness are injected, never read from the clock — so the backoff and
 * terminal-transition behavior is provable without the emulator.
 */

describe("deterministic ids / keys", () => {
  it("derives a stable outbox id and provider key for a request", () => {
    expect(outboxIdFor("delivery_confirmation_email", "req-1")).toBe(
      "delivery_confirmation_email__req-1",
    );
    // Kept identical to the pre-outbox value so historical keys are unchanged.
    expect(providerIdempotencyKeyFor("req-1")).toBe(
      "delivery-confirmation-req-1",
    );
  });
});

describe("computeBackoffMs", () => {
  it("follows the schedule with zero jitter when rng()=0.5", () => {
    const zeroJitter = () => 0.5;
    for (let i = 0; i < BACKOFF_SCHEDULE_MS.length; i++) {
      expect(computeBackoffMs(i + 1, zeroJitter)).toBe(BACKOFF_SCHEDULE_MS[i]);
    }
  });

  it("caps at the last schedule entry for attempts beyond the schedule", () => {
    const last = BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
    expect(computeBackoffMs(99, () => 0.5)).toBe(last);
  });

  it("stays within the jitter band and never negative", () => {
    for (const rng of [() => 0, () => 0.999]) {
      const base = BACKOFF_SCHEDULE_MS[0];
      const v = computeBackoffMs(1, rng);
      expect(v).toBeGreaterThanOrEqual(Math.round(base * 0.8) - 1);
      expect(v).toBeLessThanOrEqual(Math.round(base * 1.2) + 1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("classifyResendError", () => {
  it("treats provider input errors as permanent", () => {
    expect(classifyResendError("validation_error")).toBe("permanent");
    expect(classifyResendError("invalid_to_address")).toBe("permanent");
  });
  it("treats rate-limit / server / unknown / missing as transient", () => {
    expect(classifyResendError("rate_limit_exceeded")).toBe("transient");
    expect(classifyResendError("application_error")).toBe("transient");
    expect(classifyResendError("internal_server_error")).toBe("transient");
    expect(classifyResendError(undefined)).toBe("transient");
    expect(classifyResendError("something_new")).toBe("transient");
  });
  it("only transient is retryable", () => {
    expect(isRetryableCategory("transient")).toBe(true);
    expect(isRetryableCategory("permanent")).toBe(false);
    expect(isRetryableCategory("configuration_disabled")).toBe(false);
    expect(isRetryableCategory("recipient_ineligible")).toBe(false);
    expect(isRetryableCategory("max_attempts")).toBe(false);
  });
});

describe("decideAfterFailure", () => {
  it("schedules a retry for a transient failure below the attempt cap", () => {
    const d = decideAfterFailure(1, "transient", () => 0.5);
    expect(d.state).toBe("pending");
    expect(d.retryDelayMs).toBe(BACKOFF_SCHEDULE_MS[0]);
  });

  it("becomes terminal max_attempts once the cap is reached", () => {
    const d = decideAfterFailure(MAX_ATTEMPTS, "transient");
    expect(d.state).toBe("failed");
    expect(d.category).toBe("max_attempts");
  });

  it("is immediately terminal for non-transient categories", () => {
    for (const category of [
      "permanent",
      "configuration_disabled",
      "recipient_ineligible",
    ] as const) {
      const d = decideAfterFailure(1, category);
      expect(d.state).toBe("failed");
      expect(d.category).toBe(category);
      expect(d.retryDelayMs).toBeUndefined();
    }
  });
});
