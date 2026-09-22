import { afterEach, describe, expect, it, vi } from "vitest";

import { AppValidationError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const setTag = vi.fn();
  return {
    setTag,
    captureException: vi.fn(() => "evt-test-1"),
    flush: vi.fn(async () => true),
    withScope: vi.fn((cb: (scope: { setTag: typeof setTag }) => unknown) =>
      cb({ setTag }),
    ),
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  flush: mocks.flush,
  withScope: mocks.withScope,
}));

import { captureServerError } from "../serverCapture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("captureServerError", () => {
  it("does nothing when Sentry is not configured", async () => {
    const result = await captureServerError(new Error("boom"), {
      route: "api.thing",
    });
    expect(result).toBeUndefined();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("filters expected business-state errors without touching Sentry", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");

    for (const error of [
      new Error("DUPLICATE_ACTIVE_REQUEST"),
      new Error("DRIVER_IN_COOLDOWN"),
      new AppValidationError("Phone number is required."),
    ]) {
      expect(await captureServerError(error, { route: "api.thing" })).toBe(
        undefined,
      );
    }
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("captures an unexpected error with safe operational tags and flushes", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test_1");

    const error = new TypeError("Cannot read properties of undefined");
    const eventId = await captureServerError(error, {
      route: "api.cron.notifications",
      requestId: "req-77",
      component: "outbox",
    });

    expect(eventId).toBe("evt-test-1");
    expect(mocks.captureException).toHaveBeenCalledWith(error);
    expect(mocks.setTag).toHaveBeenCalledWith(
      "route",
      "api.cron.notifications",
    );
    expect(mocks.setTag).toHaveBeenCalledWith("requestId", "req-77");
    expect(mocks.setTag).toHaveBeenCalledWith("component", "outbox");
    expect(mocks.setTag).toHaveBeenCalledWith("deploymentId", "dpl_test_1");
    expect(mocks.setTag).toHaveBeenCalledWith("capture", "apiRouteBoundary");
    expect(mocks.flush).toHaveBeenCalled();
  });

  it("never propagates a monitoring failure", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
    mocks.captureException.mockImplementationOnce(() => {
      throw new Error("sentry sdk exploded");
    });

    await expect(
      captureServerError(new Error("boom"), { route: "api.thing" }),
    ).resolves.toBeUndefined();
  });
});
