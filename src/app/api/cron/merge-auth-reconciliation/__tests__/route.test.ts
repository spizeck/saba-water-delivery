import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processMock, heartbeatMock } = vi.hoisted(() => ({
  processMock: vi.fn(),
  heartbeatMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: vi.fn(async () => undefined),
}));

vi.mock("@/lib/monitoring/cronHeartbeat", () => ({
  recordCronHeartbeat: heartbeatMock,
}));

vi.mock("@/lib/domain/mergeReconciliation", () => ({
  processMergeAuthReconciliation: processMock,
}));

import { GET } from "@/app/api/cron/merge-auth-reconciliation/route";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/cron/merge-auth-reconciliation",
    { headers },
  );
}

describe("GET /api/cron/merge-auth-reconciliation", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-secret" };
    processMock.mockReset();
    heartbeatMock.mockClear();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a request with a missing Authorization header", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid secret", async () => {
    const response = await GET(
      makeRequest({ authorization: "Bearer wrong-secret" }),
    );
    expect(response.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      makeRequest({ authorization: "Bearer anything" }),
    );
    expect(response.status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("runs one bounded sweep and returns aggregate counts only", async () => {
    processMock.mockResolvedValue({
      scanned: 3,
      claimed: 2,
      reconciled: 1,
      retried: 1,
      terminal: 0,
      skipped: 1,
      errors: 0,
    });

    const response = await GET(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reconciled).toBe(1);
    expect(processMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock).toHaveBeenCalledWith(
      "merge-auth-reconciliation",
      "success",
    );
    // The cron response must never leak uids or provider errors — only
    // aggregate counts and the duration field may be present.
    for (const key of Object.keys(body)) {
      expect([
        "ok",
        "scanned",
        "claimed",
        "reconciled",
        "retried",
        "terminal",
        "skipped",
        "errors",
        "durationMs",
      ]).toContain(key);
    }
  });

  it("returns 500 without throwing when the sweep fails", async () => {
    processMock.mockRejectedValue(new Error("db down"));

    const response = await GET(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(heartbeatMock).toHaveBeenCalledWith(
      "merge-auth-reconciliation",
      "failure",
    );
  });
});
