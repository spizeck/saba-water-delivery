import { describe, expect, it } from "vitest";

import { buildSecurityHeaders, type SecurityHeaderEnv } from "../headers";

const AUTH_DOMAIN = "saba-water-delivery.firebaseapp.com";

const PROD: SecurityHeaderEnv = {
  nodeEnv: "production",
  vercelEnv: "production",
  authDomain: AUTH_DOMAIN,
};
const PREVIEW: SecurityHeaderEnv = {
  nodeEnv: "production",
  vercelEnv: "preview",
  authDomain: AUTH_DOMAIN,
};
const DEV: SecurityHeaderEnv = {
  nodeEnv: "development",
  authDomain: AUTH_DOMAIN,
};

function headerMap(env: SecurityHeaderEnv): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { key, value } of buildSecurityHeaders(env)) {
    map[key] = value;
  }
  return map;
}

/** Parse a CSP header value into { directive: [sources...] }. */
function cspDirectives(env: SecurityHeaderEnv): Record<string, string[]> {
  const csp =
    headerMap(env)["Content-Security-Policy"] ??
    headerMap(env)["Content-Security-Policy-Report-Only"];
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives[tokens[0]] = tokens.slice(1);
  }
  return directives;
}

describe("Content-Security-Policy — structure", () => {
  it("emits an enforcing CSP in production", () => {
    expect(headerMap(PROD)["Content-Security-Policy"]).toBeDefined();
    expect(
      headerMap(PROD)["Content-Security-Policy-Report-Only"],
    ).toBeUndefined();
  });

  it("has a restrictive default-src and strong hardening directives", () => {
    const d = cspDirectives(PROD);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["worker-src"]).toEqual(["'self'"]);
    expect(d["manifest-src"]).toEqual(["'self'"]);
    expect(d["upgrade-insecure-requests"]).toEqual([]);
  });

  it("never uses a wildcard in high-value directives", () => {
    const d = cspDirectives(PROD);
    for (const directive of ["script-src", "connect-src", "frame-src"]) {
      for (const source of d[directive]) {
        expect(source).not.toBe("*");
        expect(source).not.toContain("*.");
        expect(source.startsWith("http")).toBe(source.includes("://"));
      }
    }
  });

  it("does NOT allow 'unsafe-eval' in production", () => {
    expect(cspDirectives(PROD)["script-src"]).not.toContain("'unsafe-eval'");
  });
});

describe("CSP — Firebase / Google auth origins (required)", () => {
  it("allows the exact Firebase Auth browser origins and nothing broader", () => {
    const d = cspDirectives(PROD);
    expect(d["script-src"]).toContain("https://apis.google.com");
    expect(d["connect-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        `https://${AUTH_DOMAIN}`,
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
      ]),
    );
    expect(d["frame-src"]).toEqual(
      expect.arrayContaining([
        "'self'",
        `https://${AUTH_DOMAIN}`,
        "https://apis.google.com",
      ]),
    );
  });

  it("omits the auth-domain origin when Firebase is not configured", () => {
    const d = cspDirectives({ nodeEnv: "production" });
    expect(d["connect-src"]).not.toContain(`https://${AUTH_DOMAIN}`);
    // The generic Google auth endpoints remain (harmless when unused).
    expect(d["connect-src"]).toContain(
      "https://identitytoolkit.googleapis.com",
    );
  });
});

describe("CSP — server-only integrations and unused analytics are ABSENT", () => {
  it("does not include Meta/WhatsApp, Resend, Firestore, or GA4 browser origins", () => {
    const csp = headerMap(PROD)["Content-Security-Policy"];
    // WhatsApp/Meta and Resend are server-side only.
    expect(csp).not.toContain("graph.facebook.com");
    expect(csp).not.toContain("connect.facebook.net");
    expect(csp).not.toContain("facebook.com");
    expect(csp).not.toContain("resend.com");
    // No client-side Firestore in this app.
    expect(csp).not.toContain("firestore.googleapis.com");
    // GA4 is not loaded in the browser today.
    expect(csp).not.toContain("googletagmanager.com");
    expect(csp).not.toContain("google-analytics.com");
  });
});

describe("CSP — image/font/style/data decisions", () => {
  it("permits data: images and self styles/fonts only", () => {
    const d = cspDirectives(PROD);
    expect(d["img-src"]).toEqual(["'self'", "data:"]);
    expect(d["font-src"]).toEqual(["'self'"]);
    expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    // No blob: is required anywhere.
    expect(headerMap(PROD)["Content-Security-Policy"]).not.toContain("blob:");
  });
});

describe("Environment differences do not leak", () => {
  it("development adds 'unsafe-eval' and HMR websockets; production does not", () => {
    const dev = cspDirectives(DEV);
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws://localhost:*");
    // ...but production has neither.
    const prod = cspDirectives(PROD);
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(prod["connect-src"].some((s) => s.startsWith("ws://"))).toBe(false);
  });

  it("preview adds the Vercel toolbar origin; production never does", () => {
    expect(headerMap(PREVIEW)["Content-Security-Policy"]).toContain(
      "https://vercel.live",
    );
    expect(headerMap(PROD)["Content-Security-Policy"]).not.toContain(
      "vercel.live",
    );
  });

  it("omits upgrade-insecure-requests in development (http localhost)", () => {
    expect(cspDirectives(DEV)["upgrade-insecure-requests"]).toBeUndefined();
  });
});

describe("CSP reporting toggle", () => {
  it("switches to Report-Only when CSP_REPORT_ONLY is set", () => {
    const map = headerMap({ ...PROD, reportOnly: true });
    expect(map["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(map["Content-Security-Policy"]).toBeUndefined();
  });
});

describe("Companion security headers", () => {
  it("sets a popup-compatible COOP and no COEP", () => {
    const map = headerMap(PROD);
    expect(map["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(map["Cross-Origin-Embedder-Policy"]).toBeUndefined();
  });

  it("keeps the standard hardening headers", () => {
    const map = headerMap(PROD);
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["X-Frame-Options"]).toBe("DENY");
  });

  it("has a conservative Permissions-Policy disabling unused capabilities", () => {
    const pp = headerMap(PROD)["Permissions-Policy"];
    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
      "accelerometer",
      "gyroscope",
      "magnetometer",
      "fullscreen",
    ]) {
      expect(pp).toContain(`${feature}=()`);
    }
  });

  it("configures HSTS intentionally in production and omits it in development", () => {
    const hsts = headerMap(PROD)["Strict-Transport-Security"];
    expect(hsts).toBe("max-age=31536000; includeSubDomains");
    expect(hsts).not.toContain("preload");
    expect(headerMap(DEV)["Strict-Transport-Security"]).toBeUndefined();
  });
});
