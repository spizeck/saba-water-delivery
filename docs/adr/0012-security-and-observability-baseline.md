# 0012. Security and observability baseline

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (built across the 2026-09-11/12 hardening
  sequence: #29 logging, #30 error handling, #31 CSP, #32 rate limiting,
  #33 health/readiness; records existing decisions)

## Context

Before government handover the app needed a coherent, low-maintenance security
and observability baseline: consistent logging and error handling, browser
hardening, abuse protection, and a way for operators/monitors to tell whether the
app is up and able to serve. These were built as a deliberate sequence and share
a set of principles worth recording together.

## Decision

- **Structured JSON logging with request/correlation IDs.** One canonical logger
  emits JSON lines with a stable event name and an ambient request id
  (`x-request-id`), with a redaction layer that strips secrets/PII. This is
  operational telemetry, distinct from the durable audit trail
  ([0010](./0010-audit-events-vs-application-logs.md)).
- **Standardized error handling at one API boundary.** `withApiRoute` wraps route
  handlers: it resolves/echoes the request id, logs completion once, and
  normalizes any unhandled throw into a safe `AppError` response — no stack
  traces, provider payloads, or secrets ever reach the client.
- **Security-event logging.** Noteworthy authz/validation failures (denied
  authorization, invalid webhook signature, unauthorized cron, rate-limit
  exceeded) are logged as `security.*` events with safe metadata only.
- **CSP and companion security headers**, defined in one place and applied to all
  responses via `next.config.ts`. The policy is derived from what the app
  actually loads (Firebase Auth origins), not a generic template.
- **Centralized rate limiting as defense-in-depth** for abuse-sensitive
  operations, keyed by opaque hashed identifiers, backed by Firestore. It is
  **fail-open**: a limiter storage/config failure logs and allows the request.
- **Health vs. readiness are intentionally different.** `/api/health` is
  liveness — a constant, dependency-free `{status:"ok"}`. `/api/readiness`
  reflects whether the app can serve, probing **Firestore** (the one
  readiness-critical dependency); optional integrations (email, WhatsApp) do
  **not** make readiness fail.

## Alternatives considered

- **A monitoring vendor (Sentry/OpenTelemetry/etc.):** rejected for this scale —
  structured stdout logs captured by Vercel plus health/readiness endpoints meet
  the need without another dependency or cost.
- **Rate limiting that fails closed:** rejected — the limiter must never turn a
  Firestore blip into a water-delivery outage; authentication and business rules,
  not the limiter, are the authoritative controls.
- **A single readiness check that also fails on integration outages:** rejected —
  it would report the app "down" when it can still deliver water; only Firestore
  is readiness-critical.

## Consequences

- Consistent, correlatable, privacy-preserving logs; safe client error responses.
- Rate limiting adds resilience without becoming a new availability dependency.
- Monitors can distinguish "app down" (liveness) from "dependency degraded"
  (readiness).

## Operational implications

- **Dangerous assumptions to preserve:** (1) rate limiting is defense-in-depth
  and **may fail open** on storage/config failure — do not make it authoritative;
  authentication and business authorization remain the real boundaries. (2)
  **Health and readiness have different semantics** — do not make liveness depend
  on Firestore, and do not make readiness fail on an optional-integration outage.
- `RATE_LIMIT_HASH_SECRET` is required in deployed environments; if missing, the
  limiter fails open and logs loudly (see [`../DEPLOYMENT.md`](../DEPLOYMENT.md)).
- Health/readiness are for operators/uptime monitors; Vercel does not auto-consume
  them.

## References

- [`src/lib/logging/`](../../src/lib/logging), [`src/lib/errors/`](../../src/lib/errors),
  [`src/lib/http/apiRoute.ts`](../../src/lib/http/apiRoute.ts)
- [`src/lib/security/headers.ts`](../../src/lib/security/headers.ts),
  [`src/lib/security/rateLimit.ts`](../../src/lib/security/rateLimit.ts)
- [`src/app/api/health/route.ts`](../../src/app/api/health/route.ts),
  [`src/app/api/readiness/route.ts`](../../src/app/api/readiness/route.ts),
  [`src/lib/health/`](../../src/lib/health)
- TECHNICAL.md "Operational logging and observability", "Server error handling",
  "Browser security headers / CSP", "Rate limiting", "Health and readiness endpoints"
