import { describe, expect, it, vi } from "vitest";

import {
  resolveSmokeTarget,
  runSmokeChecks,
  validateHealth,
  validateHomePage,
  validateLoginPage,
  validateManifest,
  validateReadiness,
  validateSecurityHeaders,
  validateServiceWorker,
  SMOKE_ALLOWED_METHODS,
} from "../production-smoke.mjs";

/**
 * Tests for the non-destructive production smoke runner (issue #84).
 *
 * Two safety properties matter most and are proven here:
 *   1. Target validation is fail-closed — a live public target requires the
 *     explicit --production acknowledgement, and localhost/loopback/private
 *     targets can never masquerade as production.
 *   2. The runner is structurally read-only — every probe is issued with
 *     method GET, and no result ever carries response bodies, headers,
 *     cookies, or secrets.
 *
 * All fetch calls are injected fakes — no real network is touched.
 */

// --- Target validation ---------------------------------------------------------

describe("resolveSmokeTarget", () => {
  it("rejects a missing URL", () => {
    expect(resolveSmokeTarget({ production: true })).toHaveProperty("error");
    expect(resolveSmokeTarget({ url: "  ", production: true })).toHaveProperty(
      "error",
    );
  });

  it("accepts a valid HTTPS production target with --production", () => {
    const r = resolveSmokeTarget({
      url: "https://saba-water-delivery.vercel.app",
      production: true,
    });
    expect(r).toEqual({
      origin: "https://saba-water-delivery.vercel.app",
      production: true,
    });
  });

  it("rejects a live public target without --production", () => {
    const r = resolveSmokeTarget({
      url: "https://saba-water-delivery.vercel.app",
      production: false,
    });
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/--production/);
  });

  it("rejects a malformed URL", () => {
    expect(
      resolveSmokeTarget({ url: "not a url", production: true }),
    ).toHaveProperty("error");
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of ["ftp://example.com", "file:///etc/passwd"]) {
      expect(resolveSmokeTarget({ url, production: true })).toHaveProperty(
        "error",
      );
    }
  });

  it("rejects localhost in production mode", () => {
    for (const url of ["https://localhost", "https://api.localhost"]) {
      const r = resolveSmokeTarget({ url, production: true });
      expect(r).toHaveProperty("error");
    }
  });

  it("rejects loopback IPv4 in production mode", () => {
    const r = resolveSmokeTarget({
      url: "https://127.0.0.1",
      production: true,
    });
    expect(r).toHaveProperty("error");
  });

  it("rejects loopback IPv6 in production mode", () => {
    const r = resolveSmokeTarget({ url: "https://[::1]", production: true });
    expect(r).toHaveProperty("error");
  });

  it("rejects private/other IP literals in production mode", () => {
    for (const url of [
      "https://10.0.0.5",
      "https://192.168.1.10",
      "https://172.16.0.1",
      "https://169.254.169.254", // cloud metadata — SSRF footgun
      "https://[fd00::1]",
    ]) {
      expect(resolveSmokeTarget({ url, production: true })).toHaveProperty(
        "error",
      );
    }
  });

  it("rejects credentials embedded in the URL", () => {
    const r = resolveSmokeTarget({
      url: "https://user:pass@saba-water-delivery.vercel.app",
      production: true,
    });
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/credential/i);
  });

  it("rejects fragments, query strings, and path prefixes", () => {
    for (const url of [
      "https://app.example.com/#frag",
      "https://app.example.com/?x=1",
      "https://app.example.com/admin",
    ]) {
      expect(resolveSmokeTarget({ url, production: true })).toHaveProperty(
        "error",
      );
    }
  });

  it("rejects http:// and non-default ports in production mode", () => {
    expect(
      resolveSmokeTarget({ url: "http://app.example.com", production: true }),
    ).toHaveProperty("error");
    expect(
      resolveSmokeTarget({
        url: "https://app.example.com:8443",
        production: true,
      }),
    ).toHaveProperty("error");
  });

  it("accepts a loopback target without --production for local verification", () => {
    for (const url of [
      "http://localhost:3100",
      "http://127.0.0.1:3100",
      "http://[::1]:3100",
    ]) {
      const r = resolveSmokeTarget({ url, production: false });
      expect(r).not.toHaveProperty("error");
      expect("origin" in r && r.production).toBe(false);
    }
  });

  it("rejects non-loopback IP literals even without --production", () => {
    // Private IPs are not loopback — they still need --production (which then
    // rejects them anyway).
    for (const url of ["http://10.0.0.5", "http://192.168.1.10"]) {
      expect(resolveSmokeTarget({ url, production: false })).toHaveProperty(
        "error",
      );
    }
  });

  it("normalizes a trailing-slash origin", () => {
    const r = resolveSmokeTarget({
      url: "https://app.example.com/",
      production: true,
    });
    expect(r).toEqual({ origin: "https://app.example.com", production: true });
  });
});

// --- Response validators ---------------------------------------------------------

const PROD_HEADERS = new Headers({
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; " +
    "frame-ancestors 'none'; script-src 'self' 'unsafe-inline' " +
    "https://apis.google.com; connect-src 'self' " +
    "https://identitytoolkit.googleapis.com; upgrade-insecure-requests",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
});

describe("response validators", () => {
  it("health: 200 + {status:ok} passes", () => {
    expect(validateHealth(200, { status: "ok" })).toBeNull();
  });

  it("health: wrong status or invalid payload fails", () => {
    expect(validateHealth(503, { status: "ok" })).toBe("http_status");
    expect(validateHealth(200, { status: "degraded" })).toBe("invalid_body");
    expect(validateHealth(200, "not json")).toBe("invalid_body");
    expect(validateHealth(200, undefined)).toBe("invalid_body");
  });

  it("readiness: ready contract passes; not_ready / 503 fails", () => {
    expect(
      validateReadiness(200, {
        status: "ready",
        checks: { app: "ok", firestore: "ok" },
      }),
    ).toBeNull();
    expect(
      validateReadiness(503, {
        status: "not_ready",
        checks: { app: "ok", firestore: "unavailable" },
      }),
    ).toBe("http_status");
    expect(
      validateReadiness(200, {
        status: "not_ready",
        checks: { app: "ok", firestore: "unavailable" },
      }),
    ).toBe("invalid_body");
    expect(
      validateReadiness(200, {
        status: "ready",
        checks: { app: "ok", firestore: "unavailable" },
      }),
    ).toBe("invalid_body");
  });

  it("home: identity marker required; error page fails", () => {
    expect(validateHomePage(200, "<h1>Saba Water Delivery</h1>")).toBeNull();
    expect(validateHomePage(500, "")).toBe("http_status");
    expect(
      validateHomePage(200, "<h1>Application error: a server error</h1>"),
    ).toBe("missing_marker");
  });

  it("login: page identity required; misconfigured sign-in state fails", () => {
    // The provider controls hydrate client-side — the server HTML carries the
    // shell + metadata title. An error page or a missing- Firebase-config
    // deployment must FAIL.
    const html =
      "<title>Log in — Saba Water Delivery</title>" +
      "<main>Loading&hellip;</main>";
    expect(validateLoginPage(200, html)).toBeNull();
    expect(validateLoginPage(500, "")).toBe("http_status");
    expect(validateLoginPage(200, "<h1>Application error</h1>")).toBe(
      "missing_marker",
    );
    const misconfigured =
      "<title>Log in — Saba Water Delivery</title>" +
      "<h1>Sign-in is not configured yet</h1>";
    expect(validateLoginPage(200, misconfigured)).toBe("missing_marker");
  });

  it("security headers: full production set passes; missing/weak fails", () => {
    expect(
      validateSecurityHeaders(PROD_HEADERS, { requireHsts: true }),
    ).toBeNull();

    const noCsp = new Headers(PROD_HEADERS);
    noCsp.delete("content-security-policy");
    expect(validateSecurityHeaders(noCsp, { requireHsts: true })).toBe(
      "missing_header",
    );

    const weakCsp = new Headers(PROD_HEADERS);
    weakCsp.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'unsafe-eval'",
    );
    expect(validateSecurityHeaders(weakCsp, { requireHsts: true })).toBe(
      "weak_header",
    );

    const noHsts = new Headers(PROD_HEADERS);
    noHsts.delete("strict-transport-security");
    expect(validateSecurityHeaders(noHsts, { requireHsts: true })).toBe(
      "missing_header",
    );
    // HSTS is not required for non-production targets (local http runs).
    expect(validateSecurityHeaders(noHsts, { requireHsts: false })).toBeNull();

    const badReferrer = new Headers(PROD_HEADERS);
    badReferrer.set("referrer-policy", "unsafe-url");
    expect(validateSecurityHeaders(badReferrer, { requireHsts: true })).toBe(
      "weak_header",
    );
  });

  it("report-only CSP still satisfies the header check", () => {
    const headers = new Headers(PROD_HEADERS);
    headers.delete("content-security-policy");
    headers.set(
      "content-security-policy-report-only",
      PROD_HEADERS.get("content-security-policy")!,
    );
    expect(validateSecurityHeaders(headers, { requireHsts: true })).toBeNull();
  });

  it("manifest and service worker validators", () => {
    expect(validateManifest(200, { name: "Saba Water Delivery" })).toBeNull();
    expect(validateManifest(200, { name: "Other App" })).toBe("invalid_body");
    expect(validateManifest(404, undefined)).toBe("http_status");
    expect(validateServiceWorker(200, "text/javascript")).toBeNull();
    expect(validateServiceWorker(200, "text/html")).toBe("invalid_body");
  });
});

// --- Probe engine (injected fetch) -------------------------------------------------

/** A fake Response with the subset of the fetch API the runner uses. */
function fakeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  };
}

const HOME_HTML = "<html><body><h1>Saba Water Delivery</h1></body></html>";
const LOGIN_HTML =
  "<title>Log in — Saba Water Delivery</title><main>Loading&hellip;</main>";

function makeFetch(
  routes: Record<
    string,
    { status: number; body: string; headers?: Record<string, string> }
  >,
) {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return fakeResponse(404, "not found");
    return fakeResponse(route.status, route.body, route.headers);
  });
  return { fetchImpl, calls };
}

type FakeRoute = {
  status: number;
  body: string;
  headers?: Record<string, string>;
};

function healthyRoutes(): Record<string, FakeRoute> {
  return {
    "/api/health": { status: 200, body: JSON.stringify({ status: "ok" }) },
    "/api/readiness": {
      status: 200,
      body: JSON.stringify({
        status: "ready",
        checks: { app: "ok", firestore: "ok" },
      }),
    },
    "/": {
      status: 200,
      body: HOME_HTML,
      headers: Object.fromEntries(PROD_HEADERS),
    },
    "/login": { status: 200, body: LOGIN_HTML },
    "/manifest.json": {
      status: 200,
      body: JSON.stringify({ name: "Saba Water Delivery" }),
    },
    "/sw.js": {
      status: 200,
      body: "// sw",
      headers: { "content-type": "text/javascript" },
    },
  };
}

describe("runSmokeChecks", () => {
  it("passes a fully healthy deployment", async () => {
    const { fetchImpl, calls } = makeFetch(healthyRoutes());
    const result = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual([
      "health",
      "readiness",
      "home",
      "security-headers",
      "login",
      "pwa-manifest",
      "service-worker",
    ]);
    // Read-only proof: EVERY request used an allowed method (GET/HEAD only).
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(SMOKE_ALLOWED_METHODS.has(call.method ?? "")).toBe(true);
    }
    // The result carries no response bodies or headers.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Saba Water Delivery");
    expect(serialized).not.toContain("content-security-policy");
  });

  it("a single failed check makes the whole run fail", async () => {
    const routes = healthyRoutes();
    routes["/api/readiness"] = {
      status: 503,
      body: JSON.stringify({
        status: "not_ready",
        checks: { app: "ok", firestore: "unavailable" },
      }),
    };
    const { fetchImpl } = makeFetch(routes);
    const result = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "readiness")?.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "readiness")?.status).toBe(503);
  });

  it("follows same-origin redirects but fails on a cross-origin bounce", async () => {
    const routes = healthyRoutes();
    routes["/"] = {
      status: 302,
      body: "",
      headers: { location: "https://evil.example.com/" },
    };
    const { fetchImpl } = makeFetch(routes);
    const result = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "home")?.failure).toBe(
      "redirect",
    );

    // Same-origin redirect is followed fine.
    const routes2: Record<string, FakeRoute> = {
      ...healthyRoutes(),
      "/login": {
        status: 301,
        body: "",
        headers: { location: "/login?portal=resident" },
      },
      "/login?portal=resident": { status: 200, body: LOGIN_HTML },
    };
    const fake2 = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      const u = new URL(url);
      const route = routes2[u.pathname + u.search] ?? routes2[u.pathname];
      if (!route) return fakeResponse(404, "nope");
      return fakeResponse(route.status, route.body, route.headers);
    });
    const result2 = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl: fake2 as never,
    });
    expect(result2.checks.find((c) => c.name === "login")?.ok).toBe(true);
  });

  it("network errors and timeouts fail cleanly without throwing", async () => {
    const networkFail = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const r1 = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl: networkFail,
    });
    expect(r1.ok).toBe(false);
    expect(r1.checks.every((c) => !c.ok)).toBe(true);
    expect(r1.checks.find((c) => c.name === "health")?.failure).toBe("network");

    const timeoutFail = vi.fn(async (_url: string, init?: RequestInit) => {
      // Honor the abort signal like real fetch would.
      await new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "TimeoutError";
          rej(e);
        });
      });
      return fakeResponse(200, "");
    });
    const r2 = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl: timeoutFail,
      timeoutMs: 25,
    });
    expect(r2.checks.find((c) => c.name === "health")?.failure).toBe("timeout");
  });

  it("readiness not-ready is a FAIL, and a missing marker fails login", async () => {
    const routes = healthyRoutes();
    routes["/login"] = { status: 200, body: "<h1>error</h1>" };
    const { fetchImpl } = makeFetch(routes);
    const result = await runSmokeChecks({
      origin: "https://app.example.com",
      production: true,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "login")?.failure).toBe(
      "missing_marker",
    );
  });
});
