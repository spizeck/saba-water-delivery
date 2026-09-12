import { expect, test } from "@playwright/test";

/**
 * Health / security smoke — proves the RUNNING app emits the operational
 * endpoints (#33) and the security headers (#31), which unit tests alone cannot
 * confirm end to end.
 */
test.describe("health and security smoke", () => {
  test("/api/health returns 200 with a boring ok body", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers()["x-request-id"]).toBeTruthy();
  });

  test("/api/readiness reports ready against the local Firestore emulator", async ({
    request,
  }) => {
    const res = await request.get("/api/readiness");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      status: "ready",
      checks: { app: "ok", firestore: "ok" },
    });
  });

  test("page responses carry the Content-Security-Policy header", async ({
    request,
  }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const csp = res.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    // Representative directives from the canonical header config (#31).
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
