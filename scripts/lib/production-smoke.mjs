/**
 * Pure, dependency-injected logic for the NON-DESTRUCTIVE production smoke
 * runner (issue #84), `scripts/production-smoke.mjs`.
 *
 * This module is deliberately split from the CLI so every safety rule is
 * unit-testable without network access:
 *
 *   - `resolveSmokeTarget` — fail-closed target validation. An explicit URL is
 *     always required; a public target additionally requires the deliberate
 *     `--production` acknowledgement. Localhost/loopback is the only
 *     non-production target class.
 *   - `runSmokeChecks` — the probe engine. EVERY request goes through
 *     `probe()` below, which hardcodes `method: "GET"`. There is no POST/PUT/
 *     PATCH/DELETE code path anywhere in this module: the runner is
 *     structurally read-only, not merely "careful". `requests` in the result
 *     records every method+path issued so tests can prove it.
 *   - `validate*` — pure response validators (status/body/header semantics).
 *
 * No response body, header value beyond the checked security headers, cookie,
 * or secret ever leaves this module in a result — check results carry only
 * status codes, durations, and safe failure categories.
 */

export const SMOKE_DEFAULT_TIMEOUT_MS = 10_000;
export const SMOKE_MAX_REDIRECTS = 5;

/** HTTP methods this runner is allowed to issue — GET and HEAD only. */
export const SMOKE_ALLOWED_METHODS = new Set(["GET", "HEAD"]);

// --- Failure categories (safe to print/log/serialize) -------------------------

export const SMOKE_FAILURES = /** @type {const} */ ({
  TIMEOUT: "timeout",
  NETWORK: "network",
  HTTP_STATUS: "http_status",
  INVALID_BODY: "invalid_body",
  MISSING_MARKER: "missing_marker",
  MISSING_HEADER: "missing_header",
  WEAK_HEADER: "weak_header",
  REDIRECT: "redirect",
});

// --- Target validation --------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** @returns {number[] | null} octets, or null when not a valid IPv4 literal. */
function parseIpv4(hostname) {
  const m = IPV4_RE.exec(hostname);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Hostnames that can only ever mean "this machine" / non-public scopes. */
function isLocalHostname(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "host.docker.internal"
  );
}

/**
 * Classifies a URL hostname for the safety policy.
 * `new URL` keeps IPv6 brackets in `hostname` (e.g. `[::1]`).
 */
function classifyHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h.startsWith("[")) {
    // Any IPv6 literal: only ::1 is loopback; everything else is still an IP
    // literal and therefore unacceptable as a production target.
    return h === "[::1]" ? "loopback" : "ip-literal";
  }
  const octets = parseIpv4(h);
  if (octets) {
    return octets[0] === 127 ? "loopback" : "ip-literal";
  }
  if (isLocalHostname(h)) return "loopback-name";
  return "public-name";
}

/**
 * Resolves and validates the smoke target. Pure: no I/O, no process.exit.
 *
 * @param {{ url?: string, production: boolean }} input
 * @returns {{ error: string } | {
 *   origin: string,
 *   production: boolean,
 * }}
 */
export function resolveSmokeTarget({ url, production }) {
  if (!url || !url.trim()) {
    return {
      error:
        "No target given. An explicit --url=<origin> is always required — the " +
        "runner never reads a deployment URL from the environment, repository " +
        "configuration, or Vercel state.",
    };
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { error: `Malformed target URL: ${url}` };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      error: `Unsupported scheme ${parsed.protocol} — only http(s) origins are valid targets.`,
    };
  }
  if (parsed.username || parsed.password) {
    return {
      error:
        "Target URL contains embedded credentials (user:pass@host). Refusing " +
        "— credentials do not belong in a smoke target.",
    };
  }
  if (parsed.hash) {
    return {
      error:
        "Target URL contains a fragment — the runner probes an origin, not a page anchor.",
    };
  }
  if (parsed.search) {
    return {
      error: "Target URL contains a query string — pass the bare origin only.",
    };
  }
  if (parsed.pathname !== "/") {
    return {
      error:
        `Target URL has a path prefix (${parsed.pathname}) — pass the bare ` +
        "origin only (e.g. https://app.example.gov).",
    };
  }

  const kind = classifyHostname(parsed.hostname);
  const port = parsed.port;

  if (production) {
    if (parsed.protocol !== "https:") {
      return {
        error:
          "--production requires an https:// target. Plain http is never an " +
          "acceptable live deployment target.",
      };
    }
    if (kind !== "public-name") {
      return {
        error:
          `--production was given but the target is not a public hostname ` +
          `(${parsed.hostname}). Refusing: localhost, loopback/private IP ` +
          `literals, and local-style names can never be a production ` +
          `deployment.`,
      };
    }
    if (port && port !== "443") {
      return {
        error:
          `Unexpected port ${port} on a --production target. Production ` +
          `origins must be plain https on the default port.`,
      };
    }
    return { origin: parsed.origin, production: true };
  }

  // No acknowledgement → loopback/local targets only. This lets an operator
  // verify the runner itself against `next start` locally, while making it
  // impossible to point at a live deployment without saying so.
  if (kind === "loopback" || kind === "loopback-name") {
    return { origin: parsed.origin, production: false };
  }
  return {
    error:
      "Refusing to probe a non-local target without the explicit " +
      "--production acknowledgement. Confirm the URL is the intended live " +
      "deployment and re-run with --production.",
  };
}

// --- Pure response validators --------------------------------------------------

/**
 * @param {number} status
 * @param {unknown} body parsed JSON
 */
export function validateHealth(status, body) {
  if (status !== 200) return SMOKE_FAILURES.HTTP_STATUS;
  if (
    !body ||
    typeof body !== "object" ||
    /** @type {{status?: unknown}} */ (body).status !== "ok"
  ) {
    return SMOKE_FAILURES.INVALID_BODY;
  }
  return null;
}

/**
 * Readiness contract: 200 + `status:"ready"` + `checks.app`/`checks.firestore`
 * both `"ok"`. A 503 / `not_ready` is a clean FAIL, not an error — that is the
 * endpoint's designed not-ready signal.
 */
export function validateReadiness(status, body) {
  if (status !== 200) return SMOKE_FAILURES.HTTP_STATUS;
  if (!body || typeof body !== "object") return SMOKE_FAILURES.INVALID_BODY;
  const b = /** @type {{status?: unknown, checks?: any}} */ (body);
  if (b.status !== "ready") return SMOKE_FAILURES.INVALID_BODY;
  if (b.checks?.app !== "ok" || b.checks?.firestore !== "ok") {
    return SMOKE_FAILURES.INVALID_BODY;
  }
  return null;
}

/** Home page must render the application identity, not an error shell. */
export function validateHomePage(status, html) {
  if (status < 200 || status >= 300) return SMOKE_FAILURES.HTTP_STATUS;
  if (!html.includes("Saba Water Delivery")) {
    return SMOKE_FAILURES.MISSING_MARKER;
  }
  return null;
}

/**
 * Login page contract over plain HTTP. The provider controls ("Continue with
 * Google", the disabled "Continue with Facebook") are rendered ONLY after
 * client-side hydration — `useAuth()` starts in `loading` and `LoginForm`
 * server-renders `Loading…` — so a GET probe cannot see them. What IS
 * verifiable here:
 *   - the login route renders and identifies itself (metadata title);
 *   - the deployment is NOT in the "Sign-in is not configured yet" state that
 *     `LoginForm` renders when `NEXT_PUBLIC_FIREBASE_*` is missing — a real
 *     misconfiguration this check exists to catch.
 * Button-level assertions (Google present, Facebook disabled/"Coming Soon")
 * are covered by `e2e/tests/auth.spec.ts` and staging acceptance (#83).
 */
export function validateLoginPage(status, html) {
  if (status < 200 || status >= 300) return SMOKE_FAILURES.HTTP_STATUS;
  if (!html.includes("Log in") || !html.includes("Saba Water Delivery")) {
    return SMOKE_FAILURES.MISSING_MARKER;
  }
  if (html.includes("Sign-in is not configured yet")) {
    return SMOKE_FAILURES.MISSING_MARKER;
  }
  return null;
}

/**
 * Security-header contract for a page response — mirrors the guarantees
 * `src/lib/security/headers.ts` actually makes for a production build:
 * enforcing (or report-only) CSP that is not dev-permissive, plus the
 * companion headers. `requireHsts` is asserted for production targets only
 * (HSTS is intentionally omitted on non-production builds).
 */
export function validateSecurityHeaders(headers, { requireHsts }) {
  /** @param {string} name */
  const get = (name) => headers.get(name)?.trim() ?? "";

  const csp = get("content-security-policy");
  const cspReportOnly = get("content-security-policy-report-only");
  const cspValue = csp || cspReportOnly;
  if (!cspValue) return SMOKE_FAILURES.MISSING_HEADER;
  if (
    !cspValue.includes("default-src 'self'") ||
    !cspValue.includes("frame-ancestors 'none'")
  ) {
    return SMOKE_FAILURES.WEAK_HEADER;
  }
  // A production policy must never carry the dev-only escape hatches.
  if (
    cspValue.includes("'unsafe-eval'") ||
    cspValue.includes("default-src *") ||
    cspValue.includes("localhost")
  ) {
    return SMOKE_FAILURES.WEAK_HEADER;
  }

  const expected = [
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["cross-origin-opener-policy", "same-origin-allow-popups"],
    ["x-frame-options", "deny"],
  ];
  for (const [name, want] of expected) {
    const got = get(name);
    if (!got) return SMOKE_FAILURES.MISSING_HEADER;
    if (got.toLowerCase() !== want) return SMOKE_FAILURES.WEAK_HEADER;
  }
  if (!get("permissions-policy")) return SMOKE_FAILURES.MISSING_HEADER;
  if (requireHsts && !get("strict-transport-security").includes("max-age=")) {
    return SMOKE_FAILURES.MISSING_HEADER;
  }
  return null;
}

/** PWA contract: web manifest parses and names this application. */
export function validateManifest(status, body) {
  if (status !== 200) return SMOKE_FAILURES.HTTP_STATUS;
  if (
    !body ||
    typeof body !== "object" ||
    /** @type {{name?: unknown}} */ (body).name !== "Saba Water Delivery"
  ) {
    return SMOKE_FAILURES.INVALID_BODY;
  }
  return null;
}

/** Service worker must be served as a script. */
export function validateServiceWorker(status, contentType) {
  if (status !== 200) return SMOKE_FAILURES.HTTP_STATUS;
  if (!contentType || !contentType.includes("javascript")) {
    return SMOKE_FAILURES.INVALID_BODY;
  }
  return null;
}

// --- Probe engine ----------------------------------------------------------------

/**
 * Every request the runner issues goes through here. `method` is hardcoded
 * to GET — no other method exists in this module.
 */
async function probe(ctx, path) {
  const started = Date.now();
  let url = new URL(path, ctx.origin).toString();
  ctx.requests.push({ method: "GET", path });

  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await ctx.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(ctx.timeoutMs),
        headers: { accept: "text/html,application/json,*/*" },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return {
        ok: false,
        durationMs: Date.now() - started,
        failure:
          name === "TimeoutError" || name === "AbortError"
            ? SMOKE_FAILURES.TIMEOUT
            : SMOKE_FAILURES.NETWORK,
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return {
          ok: false,
          durationMs: Date.now() - started,
          failure: SMOKE_FAILURES.REDIRECT,
          status: res.status,
        };
      }
      const next = new URL(location, url);
      // A cross-origin redirect is NEVER silently followed — a production
      // target must not pass because it bounced to an unrelated host.
      if (next.origin !== ctx.origin) {
        return {
          ok: false,
          durationMs: Date.now() - started,
          failure: SMOKE_FAILURES.REDIRECT,
          status: res.status,
        };
      }
      if (hop + 1 >= SMOKE_MAX_REDIRECTS) {
        return {
          ok: false,
          durationMs: Date.now() - started,
          failure: SMOKE_FAILURES.REDIRECT,
          status: res.status,
        };
      }
      url = next.toString();
      ctx.requests.push({ method: "GET", path: next.pathname });
      continue;
    }

    const text = await res.text().catch(() => "");
    return {
      ok: true,
      durationMs: Date.now() - started,
      status: res.status,
      headers: res.headers,
      text,
    };
  }
}

/** @param {string} text */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Runs the full non-destructive smoke checklist against `origin`.
 *
 * @param {{
 *   origin: string,
 *   production: boolean,
 *   fetchImpl: (url: string, init: object) => Promise<any>,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   checks: Array<{name: string, ok: boolean, status?: number,
 *                  durationMs: number, failure?: string}>,
 *   requests: Array<{method: string, path: string}>,
 *   durationMs: number,
 * }>}
 */
export async function runSmokeChecks(options) {
  const ctx = {
    origin: options.origin,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? SMOKE_DEFAULT_TIMEOUT_MS,
    requests: [],
  };
  const started = Date.now();
  /** @type {Array<{name: string, ok: boolean, status?: number, durationMs: number, failure?: string}>} */
  const checks = [];

  /** @param {string} name @param {Promise<any>} resP @param {(r: any) => string | null} validate */
  async function run(name, resP, validate) {
    const res = await resP;
    if (!res.ok) {
      checks.push({
        name,
        ok: false,
        durationMs: res.durationMs,
        failure: res.failure,
        ...(res.status !== undefined ? { status: res.status } : {}),
      });
      return null;
    }
    const failure = validate(res);
    checks.push({
      name,
      ok: failure === null,
      status: res.status,
      durationMs: res.durationMs,
      ...(failure ? { failure } : {}),
    });
    return res;
  }

  await run("health", probe(ctx, "/api/health"), (r) =>
    validateHealth(r.status, tryJson(r.text)),
  );

  await run("readiness", probe(ctx, "/api/readiness"), (r) =>
    validateReadiness(r.status, tryJson(r.text)),
  );

  const home = await run("home", probe(ctx, "/"), (r) =>
    validateHomePage(r.status, r.text),
  );

  // Security headers are validated on the home page response — the canonical
  // `headers()` applies them to every route, so no extra request is needed.
  // If the home fetch itself failed, report the header check as failed too
  // (never silently skip a required check).
  if (home) {
    const failure = validateSecurityHeaders(home.headers, {
      requireHsts: options.production,
    });
    checks.push({
      name: "security-headers",
      ok: failure === null,
      status: home.status,
      durationMs: 0,
      ...(failure ? { failure } : {}),
    });
  } else {
    checks.push({
      name: "security-headers",
      ok: false,
      durationMs: 0,
      failure: SMOKE_FAILURES.MISSING_HEADER,
    });
  }

  await run("login", probe(ctx, "/login"), (r) =>
    validateLoginPage(r.status, r.text),
  );

  await run("pwa-manifest", probe(ctx, "/manifest.json"), (r) =>
    validateManifest(r.status, tryJson(r.text)),
  );

  await run("service-worker", probe(ctx, "/sw.js"), (r) =>
    validateServiceWorker(r.status, r.headers.get("content-type") ?? ""),
  );

  return {
    ok: checks.every((c) => c.ok),
    checks,
    requests: ctx.requests,
    durationMs: Date.now() - started,
  };
}
