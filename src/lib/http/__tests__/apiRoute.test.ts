import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppValidationError } from "@/lib/errors";
import { REQUEST_ID_HEADER } from "@/lib/logging";

const mocks = vi.hoisted(() => ({
  captureServerError: vi.fn(async () => "evt-test"),
}));

vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: mocks.captureServerError,
}));

import { withApiRoute } from "../apiRoute";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/thing", { headers });
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function logCalls(level: "info" | "warn" | "error"): Record<string, unknown>[] {
  const idx = { debug: 0, info: 1, warn: 2, error: 3 }[level];
  return consoleSpies[idx].mock.calls.map(
    (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>,
  );
}

describe("withApiRoute — normal responses", () => {
  it("returns the handler response and echoes the inbound request id", async () => {
    const wrapped = withApiRoute("thing", async () =>
      NextResponse.json({ ok: true }, { status: 200 }),
    );
    const response = await wrapped(
      makeRequest({ [REQUEST_ID_HEADER]: "corr-42" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("corr-42");
  });

  it("passes through extra route args (dynamic params)", async () => {
    const wrapped = withApiRoute(
      "thing",
      async (_req, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params;
        return NextResponse.json({ id });
      },
    );
    const response = await wrapped(makeRequest(), {
      params: Promise.resolve({ id: "batch_9" }),
    });
    expect(await response.json()).toEqual({ id: "batch_9" });
  });
});

describe("withApiRoute — unexpected throws (closes the #29 gap)", () => {
  it("returns a safe 500 with the request id in header AND body", async () => {
    const wrapped = withApiRoute("thing", async () => {
      throw new Error("Firestore exploded at /var/task/app.js with token abc");
    });
    const response = await wrapped(
      makeRequest({ [REQUEST_ID_HEADER]: "corr-500" }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("corr-500");

    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).toBe("corr-500");
    expect(body.error).toBe(
      "An unexpected error occurred. Please try again later.",
    );

    // The raw exception, path, secret, and stack must never reach the client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Firestore exploded");
    expect(serialized).not.toContain("/var/task");
    expect(serialized).not.toContain("token abc");
    expect(serialized).not.toContain("stack");
  });

  it("logs an unexpected error exactly once, at error level, redacted", async () => {
    const wrapped = withApiRoute("thing", async () => {
      throw new Error("boom for resident@example.com");
    });
    await wrapped(makeRequest());

    const errors = logCalls("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].event).toBe("api.thing.unhandled_error");
    expect(JSON.stringify(errors[0])).not.toContain("resident@example.com");
  });

  it("reports an unexpected 5xx to Sentry once, with route + request id", async () => {
    const cause = new TypeError("undefined is not a function");
    const wrapped = withApiRoute("thing", async () => {
      throw cause;
    });
    await wrapped(makeRequest({ [REQUEST_ID_HEADER]: "corr-sentry" }));

    expect(mocks.captureServerError).toHaveBeenCalledTimes(1);
    expect(mocks.captureServerError).toHaveBeenCalledWith(cause, {
      route: "api.thing",
      requestId: "corr-sentry",
    });
  });
});

describe("withApiRoute — thrown AppErrors", () => {
  it("turns a thrown AppValidationError into its intended 4xx response", async () => {
    const wrapped = withApiRoute("thing", async () => {
      throw new AppValidationError("Phone number is required.");
    });
    const response = await wrapped(makeRequest({ [REQUEST_ID_HEADER]: "v-1" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Phone number is required.");
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBe("v-1");
  });

  it("logs a 4xx AppError at warn, not as a server error", async () => {
    const wrapped = withApiRoute("thing", async () => {
      throw new AppValidationError("Bad input.");
    });
    await wrapped(makeRequest());

    expect(logCalls("error")).toHaveLength(0);
    expect(mocks.captureServerError).not.toHaveBeenCalled();
    const warns = logCalls("warn");
    expect(warns.some((w) => w.event === "api.thing.client_error")).toBe(true);
  });
});

describe("withApiRoute — framework control flow", () => {
  it("re-throws redirect() so it is not turned into a 500", async () => {
    const wrapped = withApiRoute("thing", async () => {
      redirect("/login");
    });
    // The redirect signal must propagate to Next unchanged (rejects), never be
    // swallowed into a normalized 500 response.
    await expect(wrapped(makeRequest())).rejects.toThrow();
    expect(logCalls("error")).toHaveLength(0);
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });
});
