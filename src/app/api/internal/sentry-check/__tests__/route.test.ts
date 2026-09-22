import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  captureServerError: vi.fn(async () => "evt-synthetic"),
}));

vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: mocks.captureServerError,
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new NextRequest("https://example.com/api/internal/sentry-check");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/internal/sentry-check", () => {
  it("returns 404 in production and can never throw", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");

    const response = await GET(makeRequest());
    expect(response.status).toBe(404);
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it("reports a synthetic error in preview and returns a 500 with requestId", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");

    const response = await GET(makeRequest());
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(typeof body.requestId).toBe("string");

    // The synthetic error travelled the real capture path.
    expect(mocks.captureServerError).toHaveBeenCalledTimes(1);
    const [error, context] = mocks.captureServerError.mock
      .calls[0] as unknown as [Error, { route: string; requestId: string }];
    expect(error.message).toContain("synthetic");
    expect(context.route).toBe("api.internal.sentry-check");
    expect(context.requestId).toBe(body.requestId);
  });

  it("answers cleanly (200) when Sentry is not configured", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "sentry_not_configured",
      environment: "preview",
    });
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });
});
