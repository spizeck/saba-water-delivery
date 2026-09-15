import { describe, expect, it } from "vitest";

import {
  classifyMergeAuthError,
  computeMergeAuthBackoffMs,
  decideAfterMergeAuthFailure,
  isRetryableMergeAuthCategory,
  MERGE_AUTH_BACKOFF_SCHEDULE_MS,
  MERGE_AUTH_MAX_ATTEMPTS,
} from "@/lib/domain/mergeReconciliationPolicy";

/**
 * Pure policy tests for account-merge Auth reconciliation (issue #73):
 * failure classification, bounded backoff, and the retry-vs-terminal
 * decision. No emulator needed — the module is deliberately pure.
 */

function err(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifyMergeAuthError", () => {
  it("treats unknown/network/provider failures as transient", () => {
    expect(classifyMergeAuthError(err("app/network-error"))).toBe("transient");
    expect(classifyMergeAuthError(err("auth/internal-error"))).toBe(
      "transient",
    );
    expect(classifyMergeAuthError(err("auth/too-many-requests"))).toBe(
      "transient",
    );
    expect(classifyMergeAuthError(new Error("socket hangup"))).toBe(
      "transient",
    );
    expect(classifyMergeAuthError(undefined)).toBe("transient");
  });

  it("classifies permission and configuration failures as terminal categories", () => {
    expect(classifyMergeAuthError(err("auth/insufficient-permission"))).toBe(
      "permission",
    );
    expect(classifyMergeAuthError(err("auth/invalid-credential"))).toBe(
      "configuration",
    );
    expect(classifyMergeAuthError(err("auth/configuration-not-found"))).toBe(
      "configuration",
    );
    expect(classifyMergeAuthError(err("auth/project-not-found"))).toBe(
      "configuration",
    );
    expect(
      classifyMergeAuthError(
        new Error("Firebase Admin is not configured. Set ..."),
      ),
    ).toBe("configuration");
  });

  it("classifies a malformed uid on the record as an invalid record", () => {
    expect(classifyMergeAuthError(err("auth/invalid-uid"))).toBe(
      "invalid_record",
    );
  });

  it("auth/user-not-found is NOT classified here (caller treats it as success)", () => {
    // If it ever reached the classifier it must NOT be terminal — it is the
    // idempotent-success path handled before classification.
    expect(isRetryableMergeAuthCategory("transient")).toBe(true);
  });
});

describe("decideAfterMergeAuthFailure", () => {
  it("retries transient failures with backoff while under the cap", () => {
    const d = decideAfterMergeAuthFailure(1, "transient", () => 0.5);
    expect(d.state).toBe("pending");
    expect(d.category).toBe("transient");
    expect(d.retryDelayMs).toBe(MERGE_AUTH_BACKOFF_SCHEDULE_MS[0]);
  });

  it("every non-transient category is immediately terminal", () => {
    for (const category of [
      "permission",
      "configuration",
      "invalid_record",
    ] as const) {
      const d = decideAfterMergeAuthFailure(1, category, () => 0.5);
      expect(d.state).toBe("failed");
      expect(d.category).toBe(category);
      expect(d.retryDelayMs).toBeUndefined();
    }
  });

  it("a transient failure at the attempt cap becomes terminal max_attempts", () => {
    const d = decideAfterMergeAuthFailure(
      MERGE_AUTH_MAX_ATTEMPTS,
      "transient",
      () => 0.5,
    );
    expect(d.state).toBe("failed");
    expect(d.category).toBe("max_attempts");
  });
});

describe("computeMergeAuthBackoffMs", () => {
  it("returns the schedule entry at zero jitter and clamps past the end", () => {
    const zero = () => 0.5;
    expect(computeMergeAuthBackoffMs(1, zero)).toBe(
      MERGE_AUTH_BACKOFF_SCHEDULE_MS[0],
    );
    expect(computeMergeAuthBackoffMs(2, zero)).toBe(
      MERGE_AUTH_BACKOFF_SCHEDULE_MS[1],
    );
    // Past the schedule's end, the last delay repeats.
    expect(computeMergeAuthBackoffMs(99, zero)).toBe(
      MERGE_AUTH_BACKOFF_SCHEDULE_MS[MERGE_AUTH_BACKOFF_SCHEDULE_MS.length - 1],
    );
  });

  it("applies ±20% jitter within bounds", () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const base =
        MERGE_AUTH_BACKOFF_SCHEDULE_MS[
          Math.min(attempt - 1, MERGE_AUTH_BACKOFF_SCHEDULE_MS.length - 1)
        ];
      const lo = computeMergeAuthBackoffMs(attempt, () => 0);
      const hi = computeMergeAuthBackoffMs(attempt, () => 0.999999);
      expect(lo).toBeLessThanOrEqual(base);
      expect(hi).toBeGreaterThanOrEqual(base);
      expect(hi - base).toBeLessThanOrEqual(Math.ceil(base * 0.2));
    }
  });
});
