import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEMPORARY — issue #119 Stage A only; remove with the Stage B cleanup PR.
 *
 * Covers the admin/production/enabled gates, the single fixed-message
 * capture, and the repeat guard for `sendSentryServerVerification`.
 * `captureServerError` is mocked — no real Sentry traffic from tests.
 */

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  captureServerError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: mocks.captureServerError,
}));

import { sendSentryServerVerification } from "../sentryVerification";

const DSN = "https://abc123@o0.ingest.sentry.io/0";
// Distinct fake clock per test so the per-instance cooldown never leaks
// between cases (the module keeps `lastSentAt` in process memory).
let clock = Date.parse("2026-09-22T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  // 10 minutes per test keeps `lastSentAt` fully isolated even when an
  // earlier test advanced the fake clock inside a case.
  vi.setSystemTime((clock += 600_000));
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({
    uid: "admin-1",
    profile: { roles: ["admin"] },
  });
  mocks.captureServerError.mockResolvedValue("event-id-1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("sendSentryServerVerification — authorization", () => {
  it("requires the admin role server-side", async () => {
    await sendSentryServerVerification();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("denies unauthenticated/non-admin callers before any capture", async () => {
    mocks.requireRole.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(sendSentryServerVerification()).rejects.toThrow(
      "REDIRECT:/login",
    );
    mocks.requireRole.mockRejectedValue(new Error("REDIRECT:/access-denied"));
    await expect(sendSentryServerVerification()).rejects.toThrow(
      "REDIRECT:/access-denied",
    );
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });
});

describe("sendSentryServerVerification — environment gates", () => {
  it.each(["preview", "development", "test"])(
    "is unavailable when VERCEL_ENV=%s even with a DSN",
    async (vercelEnv) => {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      const result = await sendSentryServerVerification();
      expect(result.status).toBe("unavailable");
      expect(mocks.captureServerError).not.toHaveBeenCalled();
    },
  );

  it("is unavailable in production when Sentry has no DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const result = await sendSentryServerVerification();
    expect(result.status).toBe("unavailable");
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });
});

describe("sendSentryServerVerification — capture", () => {
  it("sends exactly one fixed diagnostic error with verification tags", async () => {
    const result = await sendSentryServerVerification();
    expect(result.status).toBe("success");
    expect(mocks.captureServerError).toHaveBeenCalledTimes(1);
    const [error, context] = mocks.captureServerError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    // Fixed message — the action accepts no caller-supplied payload.
    expect((error as Error).message).toBe(
      "Sentry server verification test - 2026-09-22",
    );
    expect(context).toEqual({
      route: "admin.sentryVerification",
      component: "sentry-verification",
      capture: "sentry-verification",
    });
  });

  it("blocks a rapid repeat send within the per-instance cooldown", async () => {
    await sendSentryServerVerification();
    const second = await sendSentryServerVerification();
    expect(second.status).toBe("error");
    expect(second.message).toMatch(/recently/i);
    expect(mocks.captureServerError).toHaveBeenCalledTimes(1);

    // After the cooldown a deliberate resend is allowed (soft guard only).
    vi.setSystemTime(Date.now() + 61_000);
    const third = await sendSentryServerVerification();
    expect(third.status).toBe("success");
    expect(mocks.captureServerError).toHaveBeenCalledTimes(2);
  });

  it("reports a safe failure when capture is filtered or fails", async () => {
    mocks.captureServerError.mockResolvedValue(undefined);
    const result = await sendSentryServerVerification();
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/filtered|delivered/i);
  });
});
