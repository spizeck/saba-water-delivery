# 0019. Production exception monitoring via Sentry

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-22 (decision implemented in issue #115 /
  PR #116, merged 2026-09-22)

## Context

[ADR 0012](./0012-security-and-observability-baseline.md) originally rejected
an external monitoring vendor: structured stdout logs captured by Vercel plus
health/readiness endpoints were judged sufficient for the pilot's scale.
Production experience changed that assessment — real incidents showed that
diagnosing unexpected exceptions from logs and user screenshots alone was
slow and lossy: no stack traces, no release correlation, no proactive signal.
Issue #115 therefore introduced privacy-safe error monitoring, and issue #117
reconciled the public disclosures and this record with that deployment.

## Decision

- **Sentry (`@sentry/nextjs`) is the production exception-monitoring
  vendor** — error events only.
- **Production-only.** The runtime gate (`resolveSentryEnv().enabled` in
  `src/lib/monitoring/sentryShared.ts`) requires BOTH a configured DSN and a
  resolved production environment (`VERCEL_ENV === "production"` server-side,
  its inlined `NEXT_PUBLIC_SENTRY_ENVIRONMENT` copy client-side). Preview,
  development, test, and local builds can never emit events — even if a DSN
  is accidentally configured there — and Preview builds never upload source
  maps or create Sentry releases.
- **Structured application logs remain the canonical operational telemetry.**
  Sentry complements them: it receives only unexpected exceptions, tagged
  with the same `requestId` carried by the `x-request-id` response header and
  every log line, so a Sentry event joins to its Vercel log lines by tag
  search. Expected business-state outcomes — validation failures, normal
  401/403 denials, duplicate/stale-state conflicts, the domain's
  `SCREAMING_SNAKE` error codes and `AppError`s below 500 — stay log-only
  and are filtered both at the capture site and in `beforeSend`.
- **Privacy scrubbing is architectural, not configurational.**
  `sendDefaultPii: false` plus an allowlist scrubber (`scrubSentryEvent`)
  drops user objects, request bodies, cookies, query strings, and
  non-allowlisted headers/tags/extra/contexts; URLs lose query+fragment and
  identifier-looking path segments normalize to `:id`; exception text passes
  through the existing `logging/redaction` pipeline.
- **No session replay, no profiling, no performance tracing**
  (`tracesSampleRate: 0`), no product analytics.
- Source maps upload privately on **Production builds only** when the shared
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG` and project-specific `SENTRY_PROJECT` are
  configured; a missing token degrades to unsymbolicated traces, never a
  failed build.
- **Boundary with #62:** Sentry owns application exceptions and regressions;
  uptime/readiness/cron/backup operational alerting remains separate.

## Alternatives considered

- **Logs only (the ADR 0012 status quo):** rejected — production incidents
  showed logs/screenshots alone were insufficient for fast exception
  diagnosis.
- **Full APM/tracing (OpenTelemetry, Sentry performance):** rejected —
  disproportionate volume, cost, and complexity at this scale; error-only
  capture suffices.
- **Session replay / product analytics:** rejected on privacy grounds —
  resident operational data must not become behavioral telemetry.

## Consequences

- Unexpected production exceptions surface proactively with stack traces,
  release/deployment context, and symbolication.
- A new external service processes limited technical diagnostic data —
  mitigated by the production-only gate, allowlist scrubbing, and the public
  privacy disclosure (issue #117).
- A missing or failing Sentry configuration never breaks requests: capture is
  best-effort, and the integration disables cleanly without a DSN.
- Alert rules (new issue / regression / spike, production-scoped) live in the
  Sentry console, not the repo — operator steps in `docs/OPERATIONS.md`.

## Operational implications

- **Do not remove the production-only gate** — Preview telemetry would
  violate the stated policy and dilute signal.
- **Do not weaken the scrub allowlist or enable replay/profiling/tracing**
  without a reviewed change AND a public privacy-disclosure update.
- Sentry project/org ownership, alert destinations, and `SENTRY_AUTH_TOKEN`
  rotation are handover items (government-controlled org with at least two
  government admins — issues #61/#62).
- The `x-request-id` ↔ Sentry `requestId` tag is the primary correlation
  between a Sentry event and the structured Vercel logs.

## References

- [`src/lib/monitoring/sentryShared.ts`](../../src/lib/monitoring/sentryShared.ts),
  [`src/lib/monitoring/serverCapture.ts`](../../src/lib/monitoring/serverCapture.ts),
  [`src/instrumentation.ts`](../../src/instrumentation.ts),
  [`src/app/global-error.tsx`](../../src/app/global-error.tsx)
- Issue #115 / PR #116 (implementation); issue #117 (disclosure/docs)
- [ADR 0012](./0012-security-and-observability-baseline.md) (original vendor
  rejection — evolved, not erased) and
  [ADR 0010](./0010-audit-events-vs-application-logs.md)
- `docs/DEPLOYMENT.md` "Error monitoring (Sentry)",
  `docs/OPERATIONS.md` "Error monitoring (Sentry)",
  TECHNICAL.md "Error monitoring (Sentry, issue #115)"
