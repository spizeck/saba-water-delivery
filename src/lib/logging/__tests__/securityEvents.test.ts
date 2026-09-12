import { afterEach, describe, expect, it, vi } from "vitest";

import { SECURITY_EVENTS, logSecurityEvent } from "../securityEvents";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureWarn(fn: () => void): Record<string, unknown>[] {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  fn();
  const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
  spy.mockRestore();
  return lines;
}

describe("logSecurityEvent", () => {
  it("emits a security.* event on the security component at warn level", () => {
    const lines = captureWarn(() =>
      logSecurityEvent(SECURITY_EVENTS.cronUnauthorized, {
        route: "cron.continuity-report",
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("warn");
    expect(lines[0].event).toBe("security.cron.unauthorized");
    expect(lines[0].component).toBe("security");
    expect(lines[0].route).toBe("cron.continuity-report");
  });

  it("keeps safe metadata (uid, roles) and redacts any PII/secrets", () => {
    const lines = captureWarn(() =>
      logSecurityEvent(SECURITY_EVENTS.authorizationDenied, {
        uid: "user_abc",
        requiredRoles: ["dispatcher", "admin"],
        actualRoles: ["resident"],
        // These must never appear even if a caller mistakenly includes them.
        email: "resident@example.com",
        idToken: "eyJsecret",
      }),
    );
    const entry = lines[0];
    expect(entry.uid).toBe("user_abc");
    expect(entry.requiredRoles).toEqual(["dispatcher", "admin"]);
    expect(entry.actualRoles).toEqual(["resident"]);
    expect(entry.email).toBe("[REDACTED]");
    expect(entry.idToken).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("resident@example.com");
    expect(JSON.stringify(entry)).not.toContain("eyJsecret");
  });

  it("exposes stable event names", () => {
    expect(SECURITY_EVENTS.authorizationDenied).toBe(
      "security.authorization.denied",
    );
    expect(SECURITY_EVENTS.webhookSignatureInvalid).toBe(
      "security.webhook.signature_invalid",
    );
    expect(SECURITY_EVENTS.cronUnauthorized).toBe("security.cron.unauthorized");
  });
});
