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
  their government eligibility to deliver.
- An online, eligible driver is offered exactly one delivery at a
  time — never a list to browse. This keeps access to work fair across
  all drivers.
- The driver accepts or declines each offer. Declining too many offers
  in a day pauses new offers for that driver for a cooldown period
  (both numbers are set by an administrator).
- Once a driver accepts a delivery, they cannot be offered a second one
  until they mark the first one delivered. The resident's later
  confirmation does not hold the driver up — the driver is free for the
  next offer the moment they mark a delivery complete.
- A driver may occasionally see several deliveries assigned at once,
  each marked as part of a Delivery Run. This means a dispatcher
  deliberately assigned them a group of loads as a Delivery Run —
  it does not change how each delivery is completed, and it does not
  affect the driver's normal one-offer-at-a-time experience the rest
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

### Backups and data recovery

Backing up and restoring the water-delivery **data** (the Firestore database
and Firebase Auth identities) is covered by its own canonical runbook,
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). A maintainer should read it to:

- understand what is backed up (Firestore collections; Firebase Auth is backed
  up separately; Firebase Storage is not in production use yet);
- enable the recommended managed protections (Firestore point-in-time recovery
  and daily scheduled backups) — these are **operator/console actions and are
  not enabled by the application**;
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
