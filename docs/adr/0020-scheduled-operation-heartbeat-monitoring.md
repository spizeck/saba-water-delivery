# 0020. Scheduled-operation heartbeat monitoring

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-23 (decision implemented in issue #62)

## Context

[ADR 0012](./0012-security-and-observability-baseline.md) established the
observability baseline: structured logs for evidence, health/readiness
endpoints for probes, security events for access failures. Issue #62 then
asked for production uptime and operational alerting — and the audit found one
gap that no existing mechanism covers: **a scheduled job that never runs emits
nothing**. The continuity report, the notification-outbox worker, and the
merge-Auth reconciliation sweep all log richly *when invoked* (success,
failure, security denial) — but if Vercel Cron never invokes a route
(misconfigured schedule, disabled cron, plan limitation, platform change)
there is no error to log, no event to alert on, and the failure is discovered
only when a human notices a missing report or a backed-up outbox.

Distinguishing "ran and failed" from "never ran" requires either a
provider-native watchdog or a last-success record. Vercel Cron offers no
missed-run alerting on the current plan, and no government-controlled
monitoring account exists yet (#56/#57/#61).

## Decision

Each cron route records a **heartbeat**: a single small Firestore document
`cronHeartbeats/{cronName}` carrying `lastAttemptAt`, `lastSuccessAt`,
`lastStatus`, and `consecutiveFailures` — written by the Admin SDK at the end
of the handler, never throwing, and carrying no request data or PII.

The most frequent cron (the notification-outbox worker, every 10 minutes)
additionally runs a **watchdog pass** (`runCronWatchdog`) that evaluates every
registered cron's last-success against a per-cron staleness threshold and, for
any stale cron, emits a deduplicated `cron.heartbeat.stale` ERROR log —
deduplicated via a `lastStaleAlertAt` stamp so a persistently dead cron
re-alarms at most every 4 hours, never every 10 minutes.

The same staleness evaluation surfaces to operators on
`/admin/notifications` (a "Scheduled jobs" card) and to maintainers via the
read-only `npm run check:heartbeats` script, which reuses the fail-closed
target-resolution contract of the production integrity diagnostic.

Alert **delivery** stays with the providers: `cron.heartbeat.stale` (and the
existing `*.cron_failed` events) are the signals a Vercel/GCP log-based alert
or equivalent should route. This ADR makes the signal exist; it does not
pretend external routing is configured — that remains an operator action
tracked in `docs/OPERATIONS.md` "Production monitoring and alerting".

## Alternatives considered

- **A dedicated watchdog cron route** (`/api/cron/watchdog`): adds a fourth
  schedule to maintain and still has no observer if the scheduler itself
  stops — the notification worker already runs every 10 minutes, so folding
  the check into it detects the same failures with no new surface.
- **A new monitoring vendor** (uptime SaaS, PagerDuty): rejected — #62 prefers
  existing provider capabilities (Vercel, GCP, Sentry, Resend) and the
  recipient model must be government-controlled anyway.
- **Provider-only detection, no heartbeat documents**: Vercel's cron dashboard
  shows executions but does not alert on absence at this plan level, and a
  government operator cannot rely on a developer-owned dashboard. The
  heartbeat record makes the signal provider-independent and admin-visible.
- **Writing health state into an existing collection** (e.g.
  `systemInvariants`): rejected — heartbeat semantics (append-on-run
  timestamps, staleness thresholds, alert dedup stamp) are distinct from
  invariant records; a purpose collection keeps both models honest.

## Consequences

- Absence of a scheduled run becomes a first-class, alertable signal instead
  of silence. The continuity report's "no PDF arrived" scenario now has a
  `cron.heartbeat.stale` event and a stale row in the admin UI within ~27h.
- One small Firestore document write per cron invocation (three crons →
  ~150 writes/day worst case) plus one read per cron per watchdog pass —
  negligible volume.
- The watchdog is itself inside a cron, so a fully dead scheduler still ends
  at the external uptime monitor on `/api/health` — documented as the last
  line of detection, not eliminated.
- A brand-new deployment (or a renamed cron) shows `never recorded`/stale
  until the first run — acceptable and self-correcting, and visible on the
  admin card rather than silently alarming.
- `cronHeartbeats` is deny-by-default in Firestore rules (Admin SDK only);
  it stores operational metadata only — timestamps, status enum, counters.

## Operational implications

- **Do not remove the heartbeat writes** from the cron routes — they are the
  only record that a run occurred. If a new scheduled route is added, register
  it in `CRON_EXPECTATIONS` (`src/lib/monitoring/cronHeartbeat.ts`) and in the
  script's expectation list (`scripts/check-cron-heartbeats.mjs`) — they are
  deliberately duplicated constants (the script cannot import `src`), kept in
  sync by convention.
- Heartbeat failures never break the cron they observe — `recordCronHeartbeat`
  swallows errors into a warn log. If heartbeats stop recording, the watchdog
  will flag the cron as stale; that is the designed behavior, not a bug.
- Alert *routing* (`cron.heartbeat.stale` → an actual notification) requires
  the external configuration documented in `docs/OPERATIONS.md`; absence of
  that routing is a known open item, not a code defect.

## References

- `src/lib/monitoring/cronHeartbeat.ts` — heartbeat write, watchdog,
  staleness evaluation, admin read.
- `src/app/api/cron/{continuity-report,notifications,merge-auth-reconciliation}/route.ts`
- `scripts/check-cron-heartbeats.mjs` — read-only heartbeat check.
- `docs/OPERATIONS.md` — "Production monitoring and alerting" (alert matrix,
  recipient model, controlled test procedure).
- Issue #62; related: #60 (backup alerting), #61 (government admins), #63
  (handover drill).
