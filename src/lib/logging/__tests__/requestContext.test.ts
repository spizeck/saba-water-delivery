import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REQUEST_ID_HEADER,
  extractRequestId,
  generateRequestId,
  sanitizeRequestId,
  withRequestLogging,
} from "../requestContext";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/thing", { headers });
}

describe("generateRequestId", () => {
  it("returns a non-empty, safe-charset id", () => {
    const id = generateRequestId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[a-zA-Z0-9\-_]+$/);
  });

  it("returns a distinct value each call", () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe("sanitizeRequestId", () => {
  it("accepts a valid supplied id", () => {
    expect(sanitizeRequestId("abc-123_DEF")).toBe("abc-123_DEF");
  });

  it("rejects empty, over-long, and unsafe values", () => {
    expect(sanitizeRequestId(null)).toBeUndefined();
    expect(sanitizeRequestId("")).toBeUndefined();
    expect(sanitizeRequestId("a".repeat(65))).toBeUndefined();
    expect(sanitizeRequestId("has spaces")).toBeUndefined();
    expect(sanitizeRequestId("inject\nnewline")).toBeUndefined();
    expect(sanitizeRequestId("semi;colon")).toBeUndefined();
  });
});

describe("extractRequestId", () => {
  it("preserves a valid inbound x-request-id header", () => {
    expect(
      extractRequestId(makeRequest({ [REQUEST_ID_HEADER]: "valid-1" })),
    ).toBe("valid-1");
  });

  it("generates a fresh id when the header is missing or invalid", () => {
    expect(extractRequestId(makeRequest())).toMatch(/^[a-zA-Z0-9\-_]+$/);
    const fromBad = extractRequestId(
      makeRequest({ [REQUEST_ID_HEADER]: "not valid!" }),
    );
    expect(fromBad).not.toBe("not valid!");
    expect(fromBad).toMatch(/^[a-zA-Z0-9\-_]+$/);
  });
});

describe("withRequestLogging", () => {
  it("echoes the request id in the response header and returns the response", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const wrapped = withRequestLogging("thing", async () =>
      NextResponse.json({ ok: true }, { status: 200 }),
    );
    const response = await wrapped(
      makeRequest({ [REQUEST_ID_HEADER]: "corr-42" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("corr-42");
  });

  it("re-throws handler errors unchanged (does not reshape the response)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("handler exploded");
    const wrapped = withRequestLogging("thing", async () => {
      throw boom;
    });
    await expect(wrapped(makeRequest())).rejects.toBe(boom);
  });
});
