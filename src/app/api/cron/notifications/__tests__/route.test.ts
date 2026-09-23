import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processNotificationOutboxMock, heartbeatMocks } = vi.hoisted(() => ({
  processNotificationOutboxMock: vi.fn(),
  heartbeatMocks: {
    recordCronHeartbeat: vi.fn(async () => undefined),
    runCronWatchdog: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: vi.fn(async () => undefined),
}));

vi.mock("@/lib/monitoring/cronHeartbeat", () => heartbeatMocks);

vi.mock("@/lib/notifications/worker", () => ({
  processNotificationOutbox: processNotificationOutboxMock,
}));

import { GET } from "@/app/api/cron/notifications/route";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/cron/notifications",
    {
      headers,
    },
  );
}

describe("GET /api/cron/notifications", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-secret" };
    processNotificationOutboxMock.mockReset();
    heartbeatMocks.recordCronHeartbeat.mockClear();
    heartbeatMocks.runCronWatchdog.mockClear();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a request with a missing Authorization header", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(processNotificationOutboxMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid secret", async () => {
    const response = await GET(
      makeRequest({ authorization: "Bearer wrong-secret" }),
    );
    expect(response.status).toBe(401);
    expect(processNotificationOutboxMock).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(
      makeRequest({ authorization: "Bearer anything" }),
    );
    expect(response.status).toBe(503);
    expect(processNotificationOutboxMock).not.toHaveBeenCalled();
  });

  it("runs one worker pass with a valid secret and returns aggregate counts only", async () => {
    processNotificationOutboxMock.mockResolvedValue({
      claimed: 2,
      sent: 2,
      failed: 0,
      rescheduled: 0,
    });

    const response = await GET(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.claimed).toBe(2);
    expect(processNotificationOutboxMock).toHaveBeenCalledTimes(1);
    // Successful run records its own heartbeat and runs the staleness watchdog.
    expect(heartbeatMocks.recordCronHeartbeat).toHaveBeenCalledWith(
      "notifications",
      "success",
    );
    expect(heartbeatMocks.runCronWatchdog).toHaveBeenCalledTimes(1);
    // The cron response must never leak notification contents or recipients —
    // only aggregate counts and the duration field may be present.
    for (const key of Object.keys(body)) {
      expect([
        "ok",
        "claimed",
        "sent",
        "failed",
        "rescheduled",
        "durationMs",
      ]).toContain(key);
    }
  });

  it("returns 500 without throwing when the worker fails", async () => {
    processNotificationOutboxMock.mockRejectedValue(new Error("db down"));

    const response = await GET(
      makeRequest({ authorization: "Bearer test-secret" }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(heartbeatMocks.recordCronHeartbeat).toHaveBeenCalledWith(
      "notifications",
      "failure",
    );
    expect(heartbeatMocks.runCronWatchdog).toHaveBeenCalledTimes(1);
  });
});
