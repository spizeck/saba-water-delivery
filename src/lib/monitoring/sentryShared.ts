/**
 * Sentry privacy layer and environment/release resolution (issue #115).
 *
 * Pure module — no `@sentry/*` runtime imports and no `server-only`, so it is
 * safe to bundle into `instrumentation-client.ts` as well as the server/edge
 * config files. Everything here is injectable (`env` parameters) so tests do
 * not depend on ambient environment variables.
 *
 * Privacy posture: the application holds resident/customer operational data,
 * so every event is scrubbed before it leaves the process. The strategy is
 * ALLOWLIST-first: instead of trying to enumerate everything sensitive, the
 * scrubber keeps only fields known to be operational metadata and drops whole
 * payload sections (request bodies, cookies, headers, user objects) outright.
 * The existing logging redaction layer (`@/lib/logging/redaction`) then
 * masks anything PII-shaped that survives inside free-text fields.
 */

import type { SeverityLevel } from "@sentry/nextjs";

import { AppError } from "@/lib/errors/appError";
import { redactObject, redactValue } from "@/lib/logging/redaction";

export type SentryRole = "client" | "server" | "edge";

export interface SentryRuntimeEnv {
  /** A DSN is present — the integration is active. */
  enabled: boolean;
  dsn?: string;
  /** "production" | "preview" | "development" | "test". */
  environment: string;
  /** Git SHA / Sentry release, when derivable from the platform. */
  release?: string;
  /** Vercel deployment id, when present. */
  deploymentId?: string;
}

/**
 * Resolves the effective Sentry runtime configuration.
 *
 * Variable roles (see docs/DEPLOYMENT.md "Canonical configuration table"):
 *   - `NEXT_PUBLIC_SENTRY_DSN` — public DSN; safe to expose, required for the
 *     integration to do anything at all. Project-specific, and in Vercel it
 *     is scoped to the Production environment so Preview builds never inline
 *     it (the runtime gate below is defense in depth on top of that).
 *   - `NEXT_PUBLIC_SENTRY_ENVIRONMENT` — inlined into the browser bundle by
 *     `next.config.ts` from `VERCEL_ENV` (which is server-only at runtime);
 *     not operator-managed.
 *   - `NEXT_PUBLIC_SENTRY_RELEASE` — likewise inlined from
 *     `VERCEL_GIT_COMMIT_SHA`; the webpack plugin's `SENTRY_RELEASE`
 *     define takes precedence on the server bundle.
 *   - `NEXT_PUBLIC_SENTRY_DEPLOYMENT_ID` — inlined from
 *     `VERCEL_DEPLOYMENT_ID` (non-secret operational metadata) so browser
 *     events carry the same `deploymentId` tag as server events. Release
 *     identifies the code commit; deploymentId identifies the particular
 *     Vercel deployment of that code/config — the same SHA can be
 *     redeployed under changed environment variables.
 */
export function resolveSentryEnv(
  env: Record<string, string | undefined> = process.env,
): SentryRuntimeEnv {
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
  // `VERCEL_ENV` server-side; its inlined `NEXT_PUBLIC_` copy client-side.
  const vercelEnv =
    env.VERCEL_ENV ?? nonEmpty(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT);
  const environment = vercelEnv ?? env.NODE_ENV ?? "development";
  const release =
    env.SENTRY_RELEASE ??
    env.NEXT_PUBLIC_SENTRY_RELEASE ??
    env.VERCEL_GIT_COMMIT_SHA ??
    undefined;
  return {
    // Policy: Sentry is production-only. A DSN alone does not enable it —
    // Preview, development, and test are disabled even if a DSN is present,
    // so accidental Preview telemetry is impossible without deliberately
    // faking VERCEL_ENV.
    enabled: Boolean(dsn) && vercelEnv === "production",
    dsn,
    environment,
    release: release || undefined,
    deploymentId:
      env.VERCEL_DEPLOYMENT_ID ??
      nonEmpty(env.NEXT_PUBLIC_SENTRY_DEPLOYMENT_ID),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Expected business-state failures must never become Sentry incidents. The
 * domain layer signals them as plain `Error`s whose message is a bare
 * SCREAMING_SNAKE code (`DUPLICATE_ACTIVE_REQUEST`, `DRIVER_IN_COOLDOWN`,
 * `LAST_ADMIN`, …) — the codebase's stable convention — or as `AppError`s
 * carrying a client-safe status below 500. Anything else (TypeError, provider
 * exceptions, Firebase Admin failures, unexpected Error messages) is
 * potentially actionable and reported.
 */
const BUSINESS_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,}$/;

export function isExpectedBusinessError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.statusCode < 500;
  }
  if (error instanceof Error) {
    return BUSINESS_ERROR_CODE.test(error.message.trim());
  }
  return false;
}

// ---------------------------------------------------------------------------
// Event scrubbing
// ---------------------------------------------------------------------------

/** Request headers worth keeping for diagnosis; everything else is dropped. */
const SAFE_REQUEST_HEADERS = new Set([
  "user-agent",
  "x-request-id",
  "referer",
  "content-type",
  "accept-language",
]);

/** Tags/context keys the app deliberately attaches — all operational, no PII. */
const SAFE_TAG_KEYS = new Set([
  "requestId",
  "deploymentId",
  "route",
  "component",
  "event",
  "logEvent",
  "environment",
  "capture",
]);

const SAFE_EXTRA_KEYS = new Set([
  ...SAFE_TAG_KEYS,
  "method",
  "statusCode",
  "durationMs",
]);

/** Runtime contexts Sentry attaches that carry no request/user data. */
const SAFE_CONTEXTS = new Set([
  "app",
  "browser",
  "os",
  "device",
  "runtime",
  "trace",
  "culture",
]);

const REDACTED = "[REDACTED]";

/**
 * A path segment is an identifier (Firestore doc id, Firebase uid, UUID) when
 * it is a long alphanumeric token containing BOTH letters and digits. Static
 * route segments (`continuity-report`, `roleEvents`, …) contain no digits and
 * are preserved.
 */
const SEGMENT_ID_PATTERN = /^[A-Za-z0-9_-]{12,}$/;

function looksLikeIdSegment(segment: string): boolean {
  return (
    SEGMENT_ID_PATTERN.test(segment) &&
    /[0-9]/.test(segment) &&
    /[A-Za-z]/.test(segment)
  );
}

/** Normalizes a path by replacing identifier-looking segments with `:id`. */
export function normalizePathForSentry(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (looksLikeIdSegment(segment) ? ":id" : segment))
    .join("/");
}

/**
 * Normalizes a URL for an event: keeps origin + normalized pathname, drops
 * query string, fragment, and any embedded credentials.
 */
export function normalizeUrlForSentry(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${normalizePathForSentry(parsed.pathname)}`;
  } catch {
    return REDACTED;
  }
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      SAFE_REQUEST_HEADERS.has(key.toLowerCase()) &&
      typeof value === "string"
    ) {
      out[key] = redactValue(value) as string;
    }
  }
  return out;
}

interface BreadcrumbLike {
  type?: string;
  category?: string;
  level?: SeverityLevel;
  message?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

/**
 * Breadcrumbs keep only their categorical shape. `message`/`data` are dropped
 * except for navigation (URLs normalized) and network crumbs (method/status/
 * normalized URL only) — console and UI crumbs can contain form values or
 * rendered text.
 */
export function scrubSentryBreadcrumb(crumb: BreadcrumbLike): BreadcrumbLike {
  const out: BreadcrumbLike = {
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    timestamp: crumb.timestamp,
  };

  if (crumb.category === "navigation" && crumb.data) {
    const data: Record<string, unknown> = {};
    for (const key of ["from", "to"]) {
      if (typeof crumb.data[key] === "string") {
        data[key] = normalizeUrlForSentry(crumb.data[key] as string);
      }
    }
    out.data = data;
    return out;
  }

  if (
    (crumb.category === "http" ||
      crumb.category === "xhr" ||
      crumb.category === "fetch") &&
    crumb.data
  ) {
    const data: Record<string, unknown> = {};
    if (typeof crumb.data.method === "string") data.method = crumb.data.method;
    if (typeof crumb.data.status_code === "number")
      data.status_code = crumb.data.status_code;
    if (typeof crumb.data.url === "string")
      data.url = normalizeUrlForSentry(crumb.data.url);
    out.data = data;
    return out;
  }

  return out;
}

function pickAllowed(
  source: unknown,
  allowed: Set<string>,
): Record<string, unknown> | undefined {
  if (!source || typeof source !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key)) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Builds the `Sentry.init` options for a runtime. Error monitoring only:
 * no performance tracing (`tracesSampleRate: 0`), no session replay, no
 * profiling, `sendDefaultPii: false`, and every event passes through
 * `scrubSentryEvent` / `scrubSentryBreadcrumb` before transport.
 *
 * `ignoreErrors` is client-only: transient browser noise (ResizeObserver,
 * aborted fetches, chunk loads) carries no signal in the browser, but the
 * same message shapes on the SERVER (undici "fetch failed" toward Firebase,
 * etc.) are actionable and must be reported.
 */
export function buildSentryInitOptions(
  role: SentryRole,
  env: Record<string, string | undefined> = process.env,
): {
  enabled: boolean;
  dsn?: string;
  environment: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  initialScope?: { tags: { deploymentId: string } };
  ignoreErrors: (string | RegExp)[];
  beforeSend: <T extends object>(event: T) => T | null;
  beforeBreadcrumb: (crumb: BreadcrumbLike) => BreadcrumbLike;
} {
  const resolved = resolveSentryEnv(env);
  return {
    enabled: resolved.enabled,
    dsn: resolved.dsn,
    environment: resolved.environment,
    release: resolved.release,
    sendDefaultPii: false,
    // Canonical deployment correlation: every event from this runtime — the
    // browser especially, which has no per-request scope — carries the Vercel
    // deployment that emitted it (same tag name the server capture uses).
    ...(resolved.deploymentId
      ? { initialScope: { tags: { deploymentId: resolved.deploymentId } } }
      : {}),
    tracesSampleRate: 0,
    ignoreErrors:
      role === "client"
        ? [
            "ResizeObserver loop",
            /^AbortError/,
            /^Failed to fetch$/i,
            /^NetworkError/i,
            /^Load failed/i,
            /^ChunkLoadError/i,
          ]
        : [],
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  };
}

/**
 * Scrubs a Sentry event in place-by-copy. Drops `user`, request body/cookies,
 * non-allowlisted headers/tags/extra/contexts, and breadcrumbs payload data;
 * normalizes URLs so identifiers never appear in paths or query strings.
 * `beforeSend`-compatible: returns the event, or `null` to drop it when the
 * primary exception is an expected business-state error (defense in depth —
 * capture sites already filter, but errors can reach the SDK through
 * `onRequestError` and auto-instrumentation too).
 */
export function scrubSentryEvent<T extends object>(event: T): T | null {
  const exception = (event as Record<string, unknown>).exception;
  if (exception && typeof exception === "object") {
    const values = (exception as Record<string, unknown>).values;
    if (
      Array.isArray(values) &&
      values.length > 0 &&
      values.every(
        (v) =>
          v &&
          typeof v === "object" &&
          typeof (v as Record<string, unknown>).value === "string" &&
          BUSINESS_ERROR_CODE.test(
            ((v as Record<string, unknown>).value as string).trim(),
          ),
      )
    ) {
      return null;
    }
  }

  const out = { ...(event as Record<string, unknown>) };

  delete out.user;
  delete out.query_string;

  const request = out.request;
  if (request && typeof request === "object") {
    const req = request as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    if (typeof req.method === "string") clean.method = req.method;
    if (typeof req.url === "string") clean.url = normalizeUrlForSentry(req.url);
    const headers = scrubHeaders(req.headers);
    if (headers) clean.headers = headers;
    out.request = clean;
  }

  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.map((b) =>
      scrubSentryBreadcrumb(b as BreadcrumbLike),
    );
  }

  const tags = pickAllowed(out.tags, SAFE_TAG_KEYS);
  if (tags) out.tags = tags;
  else delete out.tags;

  const extra = pickAllowed(out.extra, SAFE_EXTRA_KEYS);
  if (extra) out.extra = redactObject(extra);
  else delete out.extra;

  const contexts = pickAllowed(out.contexts, SAFE_CONTEXTS);
  if (contexts) out.contexts = contexts;
  else delete out.contexts;

  if (typeof out.transaction === "string") {
    out.transaction = normalizePathForSentry(out.transaction);
  }

  // Exception messages can embed provider payloads — mask URLs/PII-shaped
  // text without destroying the diagnostic value.
  if (exception && typeof exception === "object") {
    const values = (exception as Record<string, unknown>).values;
    if (Array.isArray(values)) {
      out.exception = {
        ...(exception as Record<string, unknown>),
        values: values.map((v) => {
          if (v && typeof v === "object" && "value" in v) {
            const entry = v as Record<string, unknown>;
            return {
              ...entry,
              value:
                typeof entry.value === "string"
                  ? (redactValue(entry.value) as string)
                  : entry.value,
            };
          }
          return v;
        }),
      };
    }
  }

  return out as T;
}
