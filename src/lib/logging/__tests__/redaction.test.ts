import { describe, expect, it } from "vitest";

import {
  redactHeaders,
  redactObject,
  redactUrlsInText,
  redactValue,
} from "../redaction";

describe("redactValue", () => {
  it("leaves ordinary strings unchanged", () => {
    expect(redactValue("The Bottom")).toBe("The Bottom");
    expect(redactValue("request.create.failed")).toBe("request.create.failed");
  });

  it("passes through numbers, booleans, null, and undefined", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(false)).toBe(false);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
  });

  it("masks email addresses embedded in free text", () => {
    const result = redactValue(
      "send failed for resident@example.com today",
    ) as string;
    expect(result).not.toContain("resident@example.com");
    expect(result).toContain("[REDACTED_EMAIL]");
  });

  it("masks international phone numbers embedded in free text", () => {
    const result = redactValue("could not reach +599 416 1234") as string;
    expect(result).not.toContain("416 1234");
    expect(result).toContain("[REDACTED_PHONE]");
  });

  it("does not mask long numeric IDs or timestamps without a leading +", () => {
    expect(redactValue("1699999999999")).toBe("1699999999999");
    expect(redactValue("wamid.HBgLNTk5NDE2MTIzNBUCABIY")).toBe(
      "wamid.HBgLNTk5NDE2MTIzNBUCABIY",
    );
  });

  it("redacts Bearer, Basic, and PEM private-key values", () => {
    expect(redactValue("Bearer abc123.def")).toBe("[REDACTED]");
    expect(redactValue("Basic dXNlcjpwYXNz")).toBe("[REDACTED]");
    expect(
      redactValue(
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      ),
    ).toBe("[REDACTED]");
  });

  it("strips credentials from URLs", () => {
    const result = redactValue("https://user:pass@example.com/x") as string;
    expect(result).not.toContain("pass");
    expect(result).toContain("[REDACTED]");
  });

  it("strips secret query-string parameters from URLs", () => {
    const result = redactValue(
      "https://graph.facebook.com/v1/messages?access_token=EAAsecret",
    ) as string;
    expect(result).not.toContain("EAAsecret");
    // The placeholder is URL-encoded inside the query string (%5B...%5D).
    expect(result).toMatch(/REDACTED/);
  });

  it("preserves ordinary URLs without credentials", () => {
    expect(redactValue("https://example.com/foo?x=1")).toBe(
      "https://example.com/foo?x=1",
    );
  });
});

describe("redactObject", () => {
  it("redacts secret and token keys wholesale, case-insensitively", () => {
    const result = redactObject({
      password: "hunter2",
      idToken: "eyJ...",
      accessToken: "EAA...",
      Authorization: "Bearer x",
      apiKey: "sk_live_1",
      cookie: "session=abc",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      verifyToken: "vt",
      signature: "sha256=deadbeef",
    });
    for (const key of Object.keys(result)) {
      expect(result[key]).toBe("[REDACTED]");
    }
  });

  it("redacts personal-data keys (email, phone, name, directions, notes)", () => {
    const result = redactObject({
      email: "resident@example.com",
      phone: "+599 416 1234",
      displayName: "Jane Resident",
      deliveryDirections: "Blue house past the church",
      requestNotes: "Please call first",
      note: "leave at gate",
    });
    expect(result.email).toBe("[REDACTED]");
    expect(result.phone).toBe("[REDACTED]");
    expect(result.displayName).toBe("[REDACTED]");
    expect(result.deliveryDirections).toBe("[REDACTED]");
    expect(result.requestNotes).toBe("[REDACTED]");
    expect(result.note).toBe("[REDACTED]");
  });

  it("redacts a customer snapshot object but keeps the customerId", () => {
    const result = redactObject({
      customerId: "user_abc123",
      customer: { displayName: "Jane", phone: "+599 416 1234" },
    });
    expect(result.customerId).toBe("user_abc123");
    expect(result.customer).toBe("[REDACTED]");
  });

  it("keeps safe operational identifiers and fields", () => {
    const input = {
      requestId: "req_1",
      driverId: "drv_2",
      batchId: "batch_3",
      uid: "user_4",
      status: "delivered",
      loads: 2,
      pathname: "/api/cron/continuity-report",
      sessionStep: "collect_village",
      durationMs: 12,
    };
    expect(redactObject(input)).toEqual(input);
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactObject({
      outer: { token: "abc", safe: "ok" },
      list: [{ email: "a@b.com" }, { requestId: "req_9" }],
    });
    expect(result.outer).toEqual({ token: "[REDACTED]", safe: "ok" });
    expect(result.list).toEqual([
      { email: "[REDACTED]" },
      { requestId: "req_9" },
    ]);
  });

  it("truncates pathologically deep objects instead of recursing forever", () => {
    let deep: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 20; i += 1) {
      deep = { nested: deep };
    }
    // Should not throw and should produce a JSON-serializable result.
    const result = redactObject(deep);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).toContain("[TRUNCATED]");
  });

  it("survives circular references without throwing", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redactObject(a)).not.toThrow();
  });
});

describe("redactHeaders", () => {
  it("removes authorization and cookie headers", () => {
    const result = redactHeaders({
      authorization: "Bearer secret",
      cookie: "session=abc",
      "x-hub-signature-256": "sha256=deadbeef",
      "content-type": "application/json",
    });
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.cookie).toBe("[REDACTED]");
    expect(result["x-hub-signature-256"]).toBe("[REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });
});

describe("redactUrlsInText", () => {
  it("strips credentials from URLs embedded in a message", () => {
    const result = redactUrlsInText(
      "connecting to https://user:pass@host/db then done",
    );
    expect(result).not.toContain("pass");
  });
});
