# Operations Guide

This guide explains a normal operating day for the Saba government
water-delivery system. It is written for dispatchers, drivers, and
supervisors, not developers. For step-by-step screen instructions, see
[`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md), [`DRIVER_GUIDE.md`](./DRIVER_GUIDE.md),
and [`ADMIN_GUIDE.md`](./ADMIN_GUIDE.md).

## Beginning of day

- Dispatchers should log in and check the dispatcher dashboard for:
  - Any requests still outstanding from overnight.
  - Deliveries marked complete that are awaiting resident confirmation.
  - Any unresolved disputes.
  - Drivers currently marked ineligible or in a decline cooldown.
- Drivers should log in, confirm their account is still eligible, and
  go online when ready to receive deliveries.

## Resident request lifecycle

In plain terms, a request moves through the system like this:

1. **Request** — a resident submits on the website, or a dispatcher enters
   a request for someone who called or visited the office. WhatsApp ordering
   remains a future resident feature.
2. **Preferred-driver hold** (if the resident chose a preferred
   driver) — that driver has first access to the request for a limited
   time.
3. **Available** — the request is open to the next eligible online
   driver.
4. **Claimed** — a driver has accepted the delivery.
5. **Delivered** — the driver or staff records delivery. A registered resident
   with an email receives a Review Delivery message; email failure does not
   change the recorded delivery.
6. **Confirmed / Disputed** — the resident confirms they received the
   water, reports a problem, or, if they never respond, the system
   automatically marks the delivery confirmed after 24 hours so a
   request never sits open indefinitely.

Optional Notes / Comments belong only to the individual request. Staff and
drivers should use them as supplementary operational context; they never
replace the structured location, directions, quantity, or priority fields.

Urgent and critical requests move ahead of normal requests in the
queue, but a request never loses its place due to a decline, an
expired hold, or reassignment — its original request time is always
preserved.

## Driver workflow

- A driver chooses when to go online or offline. This never affects
  their government eligibility to deliver. Going online means the driver
  is ready to receive an immediate delivery assignment.
- An online, eligible driver is automatically assigned exactly one
  delivery at a time — never a list to browse, and no separate "accept"
  step. The delivery shown to a driver is already assigned to them;
  closing the app does not release it. This keeps access to work fair
  across all drivers.
- A driver who cannot or will not make an assigned delivery uses
  Decline / Release Delivery to return it to dispatch. Releasing too
  many deliveries in a day pauses new assignments for that driver for a
  cooldown period (both numbers are set by an administrator).
- While a driver has an assigned delivery, they cannot be assigned a
  second one until they mark the first one delivered or release it. The
  resident's later confirmation does not hold the driver up — the driver
  is free for the next assignment the moment they mark a delivery complete.
- A driver may occasionally see several deliveries assigned at once,
  each marked as part of a Delivery Run. This means a dispatcher
  deliberately assigned them a group of loads as a Delivery Run —
  it does not change how each delivery is completed, and it does not
  affect the driver's normal one-assignment-at-a-time experience the rest
  of the time.

## Dispatcher workflow

- Dispatchers monitor the dashboard throughout the day for new
  requests, aging requests, deliveries awaiting confirmation, and
  disputes.
- Dispatchers can reassign a request to a different driver, override
  priority (with a reason), and resolve disputes.
- Dispatchers can enter a request for a resident who cannot use the
  website — see "Manual requests" below.
- For a driver who needs several requests assigned at once — most often
  a driver whose phone or data connection is unreliable — dispatchers
  can use a **Delivery Run** to assign a group of requests together and
  print a run sheet. This is a deliberate exception,
  separate from the normal one-offer-at-a-time driver workflow above —
  see "Delivery Runs" below.

## Delivery Runs

A Delivery Run lets a dispatcher assign several outstanding requests to
one driver at once, instead of the driver receiving them one at a time
through the app. Use it when:

- A driver's phone or data connection cannot be relied on for the
  whole day, and it is more practical to hand them a printed list of
  deliveries.
- Staff are planning a run for a driver ahead of time.

The dispatcher selects the driver and the requests, reviews the list, and
confirms. This produces a printable "Delivery Run Sheet" listing
every request with the customer's name, phone, village, quantity
(loads and gallons), directions, and a simple checkbox/notes area for
the driver (or a dispatcher, if the driver cannot use the app) to mark
off as each request is completed.

Each request in a Delivery Run is still delivered and confirmed
individually, exactly like any other request — a Delivery Run does not
change how a delivery is completed, only how it was assigned. A two-load
request appears as one entry and is delivered as one request. See
[`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md) for the step-by-step
screens.

## Manual requests

Not every resident can or will use the website. If someone calls the
office or visits in person, a dispatcher enters the request directly
using "Create Request" — either by finding their existing account or,
if they have none, by entering their name, phone, email if they have
one, village, and delivery directions. Email and an online account are
never required to receive water.

When an email is entered, the dispatcher can:

- Select an existing account if the email already matches one.
- Send the requestor a secure account-setup invitation (optional). The
  dispatcher never knows or sets the password.
- Leave the request unregistered and proceed normally.

If the system finds a possible matching resident by phone number, it
shows the match only as a suggestion — phone numbers may be shared by
households, so the dispatcher must confirm before using an existing
account.

For all manual requests the dispatcher must also select the quantity:
**1 load (1,000 gallons)** or **2 loads (2,000 gallons)**. A two-load
request is still a single request document with
one priority, one assignment, and one confirmation/dispute record. This
is a normal request, not a special case: it goes through the exact same
queue, priority, and driver-assignment rules as any other request.

Villages must be chosen from the approved list (St Johns, The Bottom,
Windwardside, Zions Hill - Lower, Zions Hill - Upper). Free-text
villages are no longer accepted. Any legacy spellings in prelaunch data
are cleaned with the one-time `scripts/migrate-villages.mjs` migration
script before go-live; unapproved or ambiguous values are reported, not
silently mapped.

## WhatsApp requests

WhatsApp ordering is a future resident feature, not currently available to
live residents. Ordering and webhook code exist; their presence does not prove
production Meta credentials or activation. Once enabled, requests will use the
same system and queue as website and dispatcher requests. See
[INTEGRATIONS.md](./INTEGRATIONS.md) for the lifecycle distinction.

WhatsApp is a front end to the same underlying system, not an
independent backup channel — it depends on the same Firestore database
as the website. If the website is unavailable because of a Firebase
outage, WhatsApp ordering is affected in the same way. See
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for exactly which
outages affect which channels.

## Water collection tracking

Before a driver marks a delivery as delivered, they record the fill station
for each physical load. The meter is resolved automatically from the driver's
assignment for that station, and The Bottom is the default fill station if no
other station is recorded. Dispatchers can reconcile missing collections from
the dispatcher portal, which creates an audit record.

## End of day

At 8:00 PM Saba time, the system automatically generates and emails an
Outstanding Delivery Snapshot report to the configured government
recipients. This report lists every request that has not yet been
delivered (unassigned and currently-assigned requests) so that, if the
website or internet becomes unavailable, staff and drivers still have
a paper/PDF record of exactly what water still needs to be delivered
and to whom. See [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for
how to use this report during an outage.

Dispatchers can also generate this report at any time (for example,
before a storm, or when testing) using "Generate Continuity Report" on
the dispatcher dashboard, and can send it by email immediately with
"Send Continuity Report Now" without waiting for 8:00 PM.

## Diagnosing a failure (for technical maintainers)

When something fails in production, the application writes structured
diagnostic logs (visible in the Vercel dashboard under the project's
**Logs**). These are operational logs for debugging only — they are
separate from, and never a substitute for, the durable request history
Firestore keeps.

Every server request is tagged with a random **request ID**, included on
every log line for that request and returned to the browser in the
`x-request-id` response header. When an unexpected error occurs, the same
ID is also included in the JSON error body as `requestId`, so it is
available even for a server fault. To diagnose a specific user-reported
failure:

1. Ask the reporter (or read from their browser's network tab) for the
   `x-request-id` header, or the `requestId` shown in the error response.
2. In Vercel → Logs, search for that ID (or, if it is unavailable, the
   route and the time it happened) to see every log line for that
   request, including the safe error name/code.
3. Each log line names a stable **event** (for example
   `whatsapp.message.processing_failed`,
   `report.continuity.email_failed`, `auth.session.verify_failed`) and
   safe context (request ID, internal record IDs, counts, outcome).

The logs are deliberately privacy-preserving: they never contain a
resident's name, phone, email, delivery directions, request notes, or
any secret or access token. If you need the full business detail of a
request (who, what, when), use the in-app request history / audit trail,
not the logs.

### Error monitoring (Sentry)

When `NEXT_PUBLIC_SENTRY_DSN` is configured, the app also reports
**unexpected** errors to Sentry (issue #115) so operators are notified
proactively instead of depending on user screenshots. Sentry complements
the structured logs — it does not replace them.

**What reaches Sentry:**

- Unhandled browser/React errors (via `app/error.tsx` and
  `app/global-error.tsx`).
- Uncaught server errors in rendering, route handlers, and Server Actions
  (via Next.js `onRequestError` in `src/instrumentation.ts`).
- Unexpected 5xx failures at the API boundary (`withApiRoute` →
  `captureServerError`), tagged with the same `requestId` as the logs and
  the `x-request-id` response header — search Sentry by tag `requestId` to
  join an event to its Vercel log lines.

**What does NOT reach Sentry:** expected business outcomes (validation
failures, normal 401/403 access denials, duplicate-request rejections,
stale-state/eligibility conflicts, intentional 404s — domain
`SCREAMING_SNAKE` error codes and `AppError`s below 500 are filtered),
routine info/warn log lines, and any customer data. Every event is
scrubbed before transport (`src/lib/monitoring/sentryShared.ts`): user
objects, request bodies, cookies, Authorization/session headers, query
strings, and non-allowlisted tags/contexts are removed, and identifier
path segments normalize to `:id`. **No session replay, no profiling, no
performance tracing.**

**Event metadata:** each event carries `environment` (always `production` —
Sentry is production-only by policy, so Preview deployments never emit
events), `release` (the Git commit SHA), `deploymentId` (Vercel deployment),
and the `route` tag (logical route name, e.g. `api.cron.notifications`).

**Triaging a Sentry issue:**

1. Open the issue → check `environment` and `release` to see where and
   which commit introduced it.
2. Use the `requestId` tag to find the matching structured logs in Vercel
   → Logs for the full request story.
3. `request.data`, cookies, and user fields are absent by design — use the
   in-app audit trail, not Sentry, for "who/what/when" business detail.

**Alerting (configured in the Sentry console, not in this repo):** create
alert rules scoped to the `production` environment only for (a) a new issue,
(b) a regression of a resolved issue, and (c) an error-rate spike — not one
notification per event. No Preview alerting exists because Preview sends no
events. Route them to the operational email/chat channel
agreed with the government team. Boundary with issue #62: **Sentry owns
application exceptions and regressions; uptime/readiness/cron/backup
alerting stays with #62's monitoring** — do not build a second uptime
monitor out of Sentry.

**Ownership and handover:** the production Sentry project must ultimately
live in a government-controlled Sentry organization with **at least two
government admins**, the alert destinations they choose, and a rotated
`SENTRY_AUTH_TOKEN` issued under that org; developer access should be
reduced after handover (issue #61). If the pilot project is still
developer-controlled, treat that as a known transitional state and record
it in the handover checklist.

### Checking whether the app is up (health & readiness)

Before digging into logs, you can confirm at a glance whether the
deployment is up and able to serve. Two endpoints answer this and expose
nothing sensitive:

- **`/api/health`** — _is the app running?_ A healthy deployment returns
  HTTP **200** with `{"status":"ok"}`. This stays 200 even if email,
  WhatsApp, or the database is having trouble — it only tells you the app
  itself is responding.
- **`/api/readiness`** — _can the app actually serve requests?_ It checks
  the database (Firebase/Firestore) the system depends on. A ready app
  returns **200** with `{"status":"ready","checks":{"app":"ok","firestore":"ok"}}`.
  If the app is running but cannot reach the database, it returns **503**
  with `"firestore":"unavailable"`.

You can check them from any browser or terminal:

```bash
curl -i https://<deployment>/api/health
curl -i https://<deployment>/api/readiness
```

What the results mean:

- **Both 200** — the runtime and Firestore probe respond. This does not test
  Firebase Auth, email, or every business operation. If users still report
  problems, use the request-ID steps above.
- **`/api/health` 200 but `/api/readiness` 503** — the app is running but
  cannot reach the database. This is a **Firebase/Firestore** problem (or a
  missing/incorrect `FIREBASE_ADMIN_*` configuration), not a crash of the
  app itself. Check Firebase status and the deployment's environment
  variables.
- **`/api/health` not returning 200** — the deployment itself is down or
  mid-deploy. Check Vercel's deployment status.

These endpoints are safe to point an external uptime monitor at. They are
a quick up/down signal only — they are **not** a substitute for the full
manual smoke test in [`TESTING.md`](./TESTING.md) after a release.

For a one-command post-deployment verification, use the non-destructive
production smoke runner (issue #84). It checks health, readiness, the home
and login pages, security headers, and PWA assets using GET requests only
— it cannot mutate anything:

```bash
npm run smoke:production -- --url https://<deployment> --production
```

`--production` is required for any non-local target — it is the deliberate
acknowledgement that you are probing a live deployment, the same
fail-closed pattern as the integrity diagnostic below. Full contract:
[`ACCEPTANCE_TESTING.md`](./ACCEPTANCE_TESTING.md) "Production smoke".

### Security events

A few log lines use the `security.*` prefix and flag noteworthy access
failures worth monitoring: `security.authorization.denied` (a signed-in
user tried to reach a portal/action they are not permitted to use),
`security.webhook.signature_invalid` (an inbound WhatsApp webhook failed
signature verification — a forged or misconfigured request), and
`security.cron.unauthorized` (the nightly report endpoint was called
without the correct secret). An occasional one is normal (a mistaken URL,
a stale cron secret); a sustained burst from one source is worth a closer
look. These carry only safe identifiers (an opaque user ID, role names),
never personal data or secrets. Routine "not signed in" redirects are
deliberately NOT flagged as security events.

### Diagnosing a blocked resource (CSP violation)

The app sends a strict Content-Security-Policy. If a page feature stops
working after a browser resource is blocked, the browser's **devtools
Console** shows a `Content Security Policy` violation naming the blocked
URL and the directive that blocked it (e.g. "Refused to connect to
'https://…' because it violates … connect-src"). To resolve one:

1. Read the violation: note the blocked origin and the directive.
2. Decide whether it is legitimate (a real dependency the app added) or
   unwanted (an injected/third-party resource the policy correctly
   blocked). If unwanted, leave the policy as-is.
3. If legitimate, add the exact origin to that directive in
   `src/lib/security/headers.ts` (never a wildcard) and redeploy. The CSP
   rationale is in [`../TECHNICAL.md`](../TECHNICAL.md) "Browser security
   headers / CSP".
4. For a cautious change, an admin can set `CSP_REPORT_ONLY=1` in Vercel
   and redeploy so violations are reported to the console without blocking
   anything, then remove it to re-enforce once the policy is confirmed.

Never disable or broaden the CSP just to silence a violation — determine
which browser resource actually needs the allowance.

### Rate limiting (abuse protection)

A few abuse-sensitive operations are rate limited to slow down automated
abuse. This is separate from the app's business rules (a resident may
still only have one active request, etc.). Quick reference for a
maintainer:

- **Which operations, and the thresholds?** Sign-in (`POST
  /api/auth/session`, 50 per 5 min per IP), resident water-request
  submission (10 per 10 min per resident), and delivery
  confirm/dispute (20 per 10 min per resident). The exact numbers live in
  one place — `RATE_LIMIT_POLICIES` in `src/lib/security/rateLimit.ts`.
- **What is NOT limited, and why:** the WhatsApp webhook (protected by
  signature + idempotency), the nightly cron (`CRON_SECRET`), PDF/report
  downloads and other staff actions (authenticated staff), and account
  invitations (staff-only). See TECHNICAL.md "Rate limiting".
- **Where is the state? How long does it live?** In Firestore, collection
  `rateLimits`, one opaque hashed document per counter, each with an
  `expiresAt` ~24h after its window ends. It is server-only (residents,
  drivers, and staff cannot read it).
- **How do I spot a rate-limit rejection in Vercel logs?** Search the
  Logs for the event `security.rate_limit.exceeded`; it names the `policy`
  and the identifier `type` (never a raw IP/email/phone).
- **A user reports being blocked (suspected false positive):** find their
  `security.rate_limit.exceeded` events; if a legitimate user (or a shared
  island IP for sign-in) is hitting a limit, raise that policy's `limit` (or
  shorten its `windowMs`) in `RATE_LIMIT_POLICIES` and redeploy. Windows
  are short, so an accidental block clears itself within minutes.
- **Adjusting a policy requires a redeploy** (thresholds are in source, not
  env). Changing them does not require touching any route.
- **If Firestore is unavailable**, the limiter *fails open* — it logs
  `rate_limit.storage_unavailable` and lets the request through, so a
  Firestore outage never blocks water-delivery operations.
- **If `RATE_LIMIT_HASH_SECRET` is missing on a deployed environment**, the
  limiter is treated as unavailable and also *fails open*, logging a
  high-severity `rate_limit.secret_missing` event on each check. This means
  rate limiting is effectively **off** until the secret is set: if you see
  that event, set `RATE_LIMIT_HASH_SECRET` in Vercel (Production and Preview
  each need one) and redeploy. See [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- **Firebase TTL:** cleanup of expired `rateLimits` documents relies on a
  one-time Firestore TTL policy (see [`DEPLOYMENT.md`](./DEPLOYMENT.md)). If
  it has not been configured, the app is still correct — expired counters
  are ignored on read — the collection just retains a few stale documents.

### Checking data integrity (read-only diagnostic)

`scripts/production-integrity.mjs` (issue #52) answers one question for an
authorized maintainer — **"is the live operational Firestore data internally
consistent?"** — before staff hit a failure. It is **read-only**: it performs
NO `update`/`set`/`delete`, no batch, no transaction, and never invokes any
reconciliation/repair tool. **Repair is never automatic.**

**What it checks** (cross-document invariants, using the app's real lifecycle
rules):

- driver-registry active-assignment locks (`activeRequestId`) — reusing the same
  rule as the runtime self-healing check;
- claimed-request ownership (assigned driver exists, is not archived, and — for
  non-batch loads — the driver's lock points back);
- Delivery Run membership both directions: batch↔request existence, a member
  that is not in its run's `originalRequestIds`, and a current member whose
  driver relationship with the run is broken — the batch has no `driverId`, the
  member has no `assignedDriverId`, or the two disagree (a current member is
  always assigned to the run's driver, so any of these is a critical,
  delivery-misdirecting contradiction), plus a batch status cache that disagrees
  with its members (the Delivery Run `activeRequestId` exception in ADR 0008 is
  honored — valid runs are never flagged);
- resident/request ownership (`customerId` → an existing user; intentionally
  unregistered `customerId: null` requests are NOT flagged);
- preferred-driver references on an active hold (missing/archived registry — a
  merely offline or ineligible preferred driver is a VALID state and is not
  flagged);
- user role ↔ Driver Registry linkage (missing linked user, linked user lacking
  the `driver` role, `driver` role with no registry link, duplicate live links);
- impossible request-state fields (a pre-claim request still carrying an
  `assignedDriverId`; a cancelled request still carrying a `dispatchBatchId`);
- account-merge reconciliation state (issue #73): terminally `failed`
  reconciliations, unresolved work stale beyond 24h, expired `processing`
  leases awaiting reclamation (informational — the sweep auto-recovers them),
  inconsistent terminal combinations (e.g. `duplicateAuthDeleted` and
  `state` disagreeing), malformed merge records, a `mergedIntoUserId` marker
  whose canonical user is missing, and a live request still owned by a
  merged-away identity.

**What it does NOT check / is NOT:** it is not a schema validator, does not
inspect Firebase Auth, does not verify backups or run a restore, and is **not**
monitoring/alerting — it is a point-in-time, on-demand check a maintainer runs.
It does not replace [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) backup
verification, the disaster-recovery validator, or the planned uptime alerting
(#62).

**Severity:** `critical` = a live operational contradiction likely to block or
misdirect a delivery (e.g. a claimed request assigned to a missing driver, a
two-way batch ownership contradiction); `warning` = a stale/malformed reference
not currently blocking a specific delivery (e.g. a self-healing stale lock, an
archived/missing preferred driver, a role/registry inconsistency); `info` =
cleanup candidate with no operational consequence. Findings print **opaque IDs
only** (Firestore doc ids / Firebase uids) — never names, emails, phones,
delivery directions, notes, or secrets.

**Bounded by default.** To avoid unbounded scans of the growing request history,
the default run scans **operational** data only: the full (small) driver /
user / batch sets plus the ACTIVE (unresolved) water requests, then resolves any
request referenced by a driver lock or a batch so a "missing reference" finding
always means a genuine absence. It reports its `scan status` as `operational`
(terminal history not scanned), `complete` (with `--full-scan`), or `truncated`
(a limit cut a read short — results are partial). Use `--full-scan` for an
exhaustive check including terminal/historical requests; `--page-size` /
`--max-records` tune the read bounds.

`--max-records` is a bound on the **total** `waterRequests` documents read — the
initially scanned page **plus** the referenced-request backfill — not a
per-phase cap. If referenced ids exceed the budget the initial scan left, the
extra ids are left **unresolved** rather than read: they are counted, they mark
the `waterRequests` scan `truncated`, and — critically — they are treated as
**not scanned, never as missing**, so a tight budget can never manufacture a
false "missing reference" finding. Raise `--max-records` (or scope the target)
to resolve them. A `truncated` result is reported as such and exits `3`, so an
incomplete scan is never presented as a clean pass.

**Target safety.** The tool requires an explicit, unambiguous target and never
falls back between the emulator and the cloud:

```bash
# Emulator (safe, local — e.g. seeded/restored data in the Firestore emulator):
firebase emulators:exec --only firestore "node scripts/production-integrity.mjs"

# Cloud production — requires the deliberate --production flag AND an explicit
# project. Credentials come from a key FILE (never inline JSON on the command
# line). Pass --database if the target is not (default).
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  node scripts/production-integrity.mjs --production --project=<gcp-project> [--database=<db>]

# Full historical scan + machine-readable output:
node scripts/production-integrity.mjs --production --project=<id> --full-scan --json
```

It refuses to run when: no target is configured; `FIRESTORE_EMULATOR_HOST` is
set alongside cloud configuration (a stale emulator variable must never silently
pass a cloud check against an empty emulator); a cloud target is requested
without `--production`; ADC mode has no explicit project (no implicit default);
or inline service-account JSON is passed. It prints the resolved
project/database before scanning. `npm run diagnose:integrity` is the same
entry point.

> **Configuration note:** the current project/credentials are the same
> developer-owned Firebase infrastructure the rest of the app uses; there is no
> separate government configuration model yet. Pass `--project` explicitly to be
> certain which project you are scanning. Long-term infrastructure
> ownership/handover is tracked separately and is not part of #52.

**Exit codes** (for scripted/operational use): `0` = the intended scan completed
without truncation and found no `critical`/`warning` findings; `1` = one or more
`critical`/`warning` findings; `2` = configuration/target/auth failure — this
covers both up-front target/argument errors **and** a failure during the read
itself (permission denied, an unavailable target, a bad database id, a read
error): the data is certified neither clean nor dirty, and the resolved
target/database is included in the message (never credentials); `3` = no
`critical`/`warning` findings but the scan was **truncated** by a limit (so a
clean bill of health cannot be certified). `info`-only findings do not, by
themselves, make the exit non-zero. A truncated or operational-scope run says so
in its output rather than printing a misleading "no inconsistencies found."
`--json` mode emits a machine-readable `{ "ok": false, "error": …, "exitCode": 2 }`
document on such a failure.

**Investigating a finding.** Read the `code` and the opaque IDs, then inspect
those documents (and their audit-event subcollections) to understand how the
state arose. For a stale driver lock specifically, the runtime self-heals it and
the targeted `scripts/reconcile-stale-driver-locks.mjs` tool can bulk-clear
prelaunch leftovers (see
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Stale driver activeRequestId").
For broader data damage, treat it as a **data-recovery** situation and follow
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — do not improvise writes. Only
use a targeted reconciliation tool when you understand the specific finding; the
diagnostic itself never repairs anything.

### Notification outbox (delivery-confirmation email)

Delivery-confirmation email is delivered from a **durable notification outbox**
with automatic retry (issue #53; see TECHNICAL.md "Durable notification outbox"
and [ADR 0017](./adr/0017-notification-outbox-and-retry.md)). What an operator
needs to know:

- **It never affects delivery.** A provider outage cannot roll back a delivery or
  block a driver; the delivery commits and the notification is retried
  separately. The notification obligation is created in the same transaction as
  the delivery, so it is never lost to a crash.
- **Automatic retry.** A transient Resend failure is retried with bounded
  exponential backoff (~1m, 5m, 15m, 1h, 3h; capped attempts) before becoming a
  terminal failure. Delivery is **at-least-once with provider de-duplication, not
  exactly-once** — a retry after a crash reuses the same Resend idempotency key,
  so a duplicate email is only possible in the rare case a retry lands outside
  Resend's de-duplication window.
- **Worker cron.** The protected route `GET /api/cron/notifications` (authorized
  by `CRON_SECRET`, same as the continuity report) processes a bounded batch each
  run. `vercel.json` schedules it every 10 minutes. **The achievable retry
  cadence depends on the Vercel plan's cron granularity** — a plan limited to
  daily crons will retry only daily. The worker is safe to run at any cadence
  (and safe to invoke manually), and `nextAttemptAt` is a lower bound, so
  adjusting the schedule or triggering the route from an external scheduler
  changes only timeliness, never correctness.
- **Configuration disabled.** If Resend is not configured, a delivery-confirmation
  notification becomes a terminal `configuration_disabled` failure (visible
  below) rather than retrying uselessly. Fix the Resend configuration, then use
  the manual retry.
- **Operator visibility + manual retry.** Sign in as an admin and open
  **`/admin/notifications`**. It shows per-state counts and the list of
  permanently failed notifications (opaque request ids, attempt count, sanitized
  failure category — never recipient email, message body, or secrets). "Retry"
  re-queues a failed notification with a fresh attempt budget; a notification
  already marked sent is never resent. The action is admin-only and
  server-authoritative.

### Account-merge Auth reconciliation (merged-away identities)

When an admin merges two accounts, the Firestore merge commits atomically —
but deleting the merged-away **Firebase Auth** identity is a separate system
that cannot join that transaction. Issue #73 made that cleanup durable; what
an operator needs to know:

- **The merged-away identity is already blocked — always.** The merge writes
  a `mergedIntoUserId` marker inside the merge transaction, and both sign-in
  paths reject that identity from the moment the merge commits. A pending or
  failed Auth cleanup is therefore an *operational* concern (leftover
  identity in Firebase), never an *access* concern.
- **Automatic convergence.** Right after the merge commits the app attempts
  to disable → revoke → delete the merged-away Auth identity. If that fails
  (Firebase outage, transient error), the protected cron
  `GET /api/cron/merge-auth-reconciliation` (`CRON_SECRET`, scheduled hourly
  in `vercel.json`) retries with bounded backoff (~1m → 12h, 7 attempts).
  Each run is bounded (at most ~25 attempts) and **starvation-free**: it
  queries due work, expired leases, and legacy records in separate targeted
  streams and interleaves them round-robin, so a backlog of permanently
  failed, not-yet-due, or even deep eligible records can never block any
  class of work behind it. Most operators never need to do anything.
- **Operator visibility.** `/admin/users/merge` shows a reconciliation panel:
  counts of pending / in-flight / stale / terminally failed work, and a
  sanitized list of unresolved merges (opaque uids, attempt count, last
  failure category — never PII or provider payloads).
- **Manual retry.** A `failed` record means the retry budget was exhausted or
  a non-retryable failure class (`permission`, `configuration`,
  `invalid_record`) needs a human — e.g. the Admin SDK service account lost
  its Firebase Auth IAM permission. Fix the underlying cause, then click
  **Retry** on the panel: it re-queues the record with a fresh attempt budget
  and attempts it immediately. The action is admin-only, idempotent, cannot
  reopen the Firestore merge, and never touches the surviving account.
- **Diagnostics.** The read-only integrity scan
  (`npm run diagnose:integrity`, issue #52) reports unresolved stale
  reconciliations, terminally failed ones, stale processing leases, and
  inconsistent record combinations — see "Checking data integrity".
- **Honest limit.** The guarantee is *convergence*: the Auth identity is
  deleted at-least-once, and the application rejects it the whole time. It is
  not an instant cross-system delete — during a Firebase Auth outage the
  identity exists in Firebase until the sweep succeeds, but it cannot sign in
  (application rejection) and is normally disabled after the first successful
  Auth contact. See
  [ADR 0018](./adr/0018-account-merge-auth-reconciliation.md).



Backing up and restoring the water-delivery **data** (the Firestore database
and Firebase Auth identities) is covered by its own canonical runbook,
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). A maintainer should read it to:

- understand what is backed up (Firestore collections; Firebase Auth is backed
  up separately; Firebase Storage is not in production use yet);
- understand which managed protections are enabled (Firestore PITR and
  daily+weekly scheduled backups are **on** for the production database —
  verified 2026-09-16) and which remain **operator/console actions** (export
  bucket, restore drill, backup-failure alerting) — nothing is enabled by the
  application;
- run the read-only recovery validator (`npm run verify:recovery`) and the
  quarterly restore drill;
- recover source code (GitHub) and environment variables (Vercel / vendor
  consoles) after a major incident.

This is distinct from [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md), which is
about keeping deliveries moving during an **outage**. The nightly continuity
report PDF is an outage aid, **not** a database backup.

By default only `info` and above are logged in production. A maintainer
can temporarily raise verbosity by setting the `LOG_LEVEL` environment
variable to `debug` in Vercel and redeploying (see
[`DEPLOYMENT.md`](./DEPLOYMENT.md)); it is optional and safe to leave
unset.

## Production monitoring and alerting (issue #62)

This section is the canonical record of **what watches the production system,
which signals exist, and what still requires external provider/console
configuration**. It distinguishes carefully between what the code produces
(signals) and what an operator must configure (delivery). **No external alert
routing is configured by this repository** — the matrix below marks each row
as implemented-in-code versus pending operator configuration.

### Monitoring architecture — who owns what

| Provider | Responsibility | Status |
| --- | --- | --- |
| **Application structured logs** (Vercel Logs) | Canonical operational/security evidence; every cron failure, readiness failure, and `security.*` event lands here with a `requestId`. | Implemented — always emitted. |
| **Sentry** | Unexpected application **exceptions** only (production-only, scrubbed, release/deployment-tagged — see "Error monitoring (Sentry)"). | Ingestion verified in Production; alert rules are console-side (below). |
| **Vercel** | Deployment/runtime/platform visibility, Cron scheduling. | Deploy/cron dashboards exist; no alert delivery configured in-repo. |
| **GCP / Firebase** | Firestore availability, backup job status, platform quotas. | PITR + scheduled backups enabled; backup-failure alerting is **issue #60**'s scope. |
| **Resend** | Transactional email delivery; its own dashboard shows sends/bounces. | Delivery failures are captured by the outbox (below). |

The repository deliberately does **not** add another monitoring vendor. The
signals below are designed so the providers above (or an equivalent
government-chosen tool) can deliver them.

### Scheduled-operation heartbeats

A cron route that fails logs an error — but a cron that is **never invoked**
logs nothing. To make absence detectable, every cron records a heartbeat
document (`cronHeartbeats/{name}`: `lastAttemptAt`, `lastSuccessAt`,
`lastStatus`, `consecutiveFailures`; see
[ADR 0020](./adr/0020-scheduled-operation-heartbeat-monitoring.md)):

- Each cron writes its heartbeat at the end of its run (success or failure).
- The notification worker (every 10 minutes) then runs a **watchdog pass**
  over all registered crons: any cron whose last success is missing or older
  than its threshold produces a deduplicated `cron.heartbeat.stale` ERROR log
  (re-alarms at most every 4 hours while stale).
- **`/admin/notifications` "Scheduled jobs"** shows each job's last success
  and a Fresh / Failing / **Stale** badge — the operator-facing view.
- **`npm run check:heartbeats`** is the read-only maintainer check — it prints
  each cron's last success/attempt and exits non-zero on any stale job, using
  the same fail-closed target contract as `diagnose:integrity`:

```bash
# Emulator:
firebase emulators:exec --only firestore "node scripts/check-cron-heartbeats.mjs"

# Production (explicit flag + project; credentials from a key FILE):
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  npm run check:heartbeats -- --production --project=<gcp-project>
```

Registered staleness thresholds (grace on top of the `vercel.json` cadence):

| Cron | Schedule | Stale after |
| --- | --- | --- |
| `notifications` | every 10 min | 1 hour |
| `merge-auth-reconciliation` | hourly at :37 | 3 hours |
| `continuity-report` | daily 00:00 UTC | 27 hours |

### Alert matrix

Severity: **critical** = service unavailable or a core function silently
broken; **warning** = degraded but still operating / a single scheduled run
missed; **info** = worth a look, no immediate action. "Delivery" is the
current routing state: **log** = structured log only (no notification
configured yet), **admin** = visible on an admin surface, **provider** =
requires console configuration by an operator.

| Condition | Signal | Severity | Debounce | Recovery | Operator action | Delivery |
| --- | --- | --- | --- | --- | --- | --- |
| App down / unreachable | `/api/health` probe failure | critical | 2–3 consecutive probe failures (uptime check interval 1–5 min) | probe returns 200 | Check Vercel deployment status; see INCIDENT_RECOVERY | **provider** — external uptime check required (below) |
| App up but Firestore unreachable | repeated `/api/readiness` 503 | critical | sustained ≥5–10 min, not a single blip | readiness returns 200 | Check Firebase status + `FIREBASE_ADMIN_*` env | **provider** — uptime check on `/api/readiness` or GCP log-based alert on readiness failures |
| Unexpected exception spike / new issue / regression | Sentry issue & alert rules | warning→critical | per Sentry rule (new issue = immediate; spike = rate threshold) | rule auto-resolves | Triage in Sentry, join to logs via `requestId` tag | **provider** — Sentry console rules (below) |
| Continuity report cron fails | `report.continuity.email_failed` / `generation_failed` + heartbeat `lastStatus: failure` | warning | alert on failure (next run is next day) | next nightly success | Check logs; report can be regenerated manually | **log** now; route via log-based alert |
| Continuity report cron absent | `cron.heartbeat.stale` (`continuity-report`) + Stale badge | warning | stale >27h | next success resets | Check Vercel Cron config/invocations | **log + admin** now; provider alert pending |
| Notification outbox worker fails/absent | `notifications.outbox.cron_failed` / `cron.heartbeat.stale` (`notifications`) | warning→critical | stale >1h | next success | Check cron + outbox at `/admin/notifications` | **log + admin** now; provider alert pending |
| Outbox terminal failure(s) | failed entries on `/admin/notifications` | warning | any terminal failure | manual retry after fix | Fix cause, then Retry on the admin page | **admin** — periodic check; provider alert pending |
| Merge reconciliation fails/absent | `merge.auth_reconciliation.cron_failed` / `cron.heartbeat.stale` | warning | stale >3h | next success | Check `/admin/users/merge` panel + Retry | **log + admin** now; provider alert pending |
| Transactional email provider down | outbox retries/backlog growing | warning | sustained backlog growth | provider recovery auto-drains | Check Resend status; no app action needed | **admin** — backlog visible; no code alert |
| Backup failure / absence | GCP backup job status | critical | any missed/failed scheduled backup | next successful backup | **Issue #60** owns backup monitoring; see DISASTER_RECOVERY | **provider** — GCP alerting, owned by #60 |
| Security event burst | `security.*` structured events | warning | sustained burst, not singles | — | Investigate source; see "Security events" | **log** — optional log-based alert |
| Deployment failure | Vercel deploy status | warning | any failed Production deploy | successful redeploy | Check Vercel build log | **provider** — Vercel notifications integration |

### External configuration — operator actions (NOT yet configured)

These steps require console access and government-controlled destinations.
Until they are done and tested, **alerting is log-only + admin surfaces** —
the signals exist, nothing pages anyone. Record each step's completion date
and evidence here or in the handover checklist when performed.

1. **Uptime check on `/api/health`** — point the provider's uptime monitor
   (or GCP Cloud Monitoring uptime check) at
   `https://<production-domain>/api/health`, interval 1–5 min, expect 200.
   Optionally a second check on `/api/readiness` expecting 200 — alert only
   on *sustained* failure (≥3 consecutive checks) to avoid transient blips.
2. **Log-based alerts** — route ERROR-level structured events to the
   operational channel. Minimum events: `cron.heartbeat.stale`,
   `*.cron_failed`, `report.continuity.*_failed`, repeated
   `security.*` bursts. On Vercel this is a Log Drain or the project's
   observability integration; on GCP a log-based alert policy — whichever the
   government platform team operates.
3. **Sentry alert rules** (console — see "Error monitoring (Sentry)"): new
   Production issue, regression, error-rate spike. **Recommended starting
   thresholds:** new issue → notify once; regression → notify once; spike →
   only when error volume exceeds ~5× the trailing-hour baseline sustained
   15 min — tune after a few weeks of real traffic, do not alert per-event.
4. **Backup alerting** — issue #60 scope: GCP alert on scheduled-backup
   job failure/absence; integrate its notification channel with the same
   government recipient model.
5. **Deployment notifications** — Vercel project notifications (or
   equivalent) for failed Production deployments.

### Government-controlled recipients (required for #62 acceptance)

Alerts must reach **government-controlled** contacts, not solely the
developer. Configure in each provider's console (no addresses in this repo):

- **Public Entity Saba IT — primary** (role-based mailbox or on-call contact)
- **Public Entity Saba IT — secondary** (second contact or shared mailbox)
- or **one agreed shared operational channel** both monitor

The exact addresses/channels are chosen by the government team during
handover (#56/#57/#61); enter them in the provider alert rules, never in the
repository. **#62 cannot close until at least two government contacts or the
agreed channel are configured and a controlled test (below) proves delivery.**

### Controlled alert-delivery test

Proves: signal → provider detects → rule fires → government recipient
receives. Prefer provider-native test facilities; never corrupt data, take
Production offline, or message residents:

1. **Uptime check** — use the uptime monitor's "send test alert"/pause-check
   feature, or temporarily point it at a deliberately-invalid path, confirm
   the notification arrives at both government contacts, then restore.
2. **Sentry rule** — use Sentry's alert-rule test/notification preview; do
   not generate synthetic production exceptions.
3. **Log-based alert** — most platforms offer "test notification"; if not,
   agree with the platform team on a temporary low-severity test rule.
4. Record the date, the recipient(s) who confirmed receipt, and the rule
   tested — that record is the #62 acceptance evidence.

### What is automated vs. manual

**Automated (in code):** health/readiness endpoints, structured operational +
security logs, Sentry exception capture, cron heartbeats + watchdog +
`cron.heartbeat.stale`, admin visibility (`/admin/notifications`,
`/admin/users/merge`), durable retry in the outbox and reconciliation sweep.

**Manual/operator:** all external alert routing above, recipient
configuration, the controlled delivery test, and periodic review of
`/admin/notifications` until provider alerts are live.

**Blocked by other issues:** government-controlled provider ownership and
admin seats (#56 GCP/Firebase, #57 Vercel, #58 Resend, #61 admins/break-glass),
backup alerting (#60), and final handover/recovery drill (#63); government
staging acceptance is #83.
