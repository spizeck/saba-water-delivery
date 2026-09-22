import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring/serverCapture", () => ({
  captureServerError: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/health/route";

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://saba-water-delivery.vercel.app/api/health", {
    headers,
  });
}

describe("GET /api/health (liveness)", () => {
  it("returns 200 with a boring { status: 'ok' } body", async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("carries a correlated x-request-id header", async () => {
    const response = await GET(makeRequest());
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("echoes a safe inbound x-request-id", async () => {
    const response = await GET(makeRequest({ "x-request-id": "probe-123" }));
    expect(response.headers.get("x-request-id")).toBe("probe-123");
  });

  it("exposes no secrets, config, or infrastructure detail", async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["status"]);
    expect(body).not.toHaveProperty("env");
    expect(body).not.toHaveProperty("config");
    expect(body).not.toHaveProperty("checks");
    expect(JSON.stringify(body)).not.toMatch(/firebase|project|vercel|key/i);
  });

  it("does not emit error or warn logs for a successful probe", async () => {
    await GET(makeRequest());

    // consoleSpies: [debug, info, warn, error]
    expect(consoleSpies[3]).not.toHaveBeenCalled(); // no error logs
    expect(consoleSpies[2]).not.toHaveBeenCalled(); // no warn logs
    // The routine completion line is emitted at debug (quiet in production).
    expect(consoleSpies[1]).not.toHaveBeenCalled(); // no info flood
  });
});
