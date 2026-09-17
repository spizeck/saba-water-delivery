# Deployment

How to reproduce and configure the production deployment. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for what each external service
is used for and its failure impact.

## Release flow

Changes reach production through this path:

```
feature branch
  → pull request
  → automated checks (GitHub Actions: CI / verify and E2E / playwright)
  → Vercel Preview deployment
  → human review
  → merge to main
  → production deployment (Vercel)
```

The two automated layers verify different things and are both required
in practice:

- **GitHub Actions** runs two required status checks (see "Continuous
  integration and branch protection" below): **`verify`** (workflow `CI`) —
  lint, typecheck, unit/domain tests, the production build including the
  PDFKit trace verification, the Firestore/Storage rules tests, and
  `format:check` — and **`playwright`** (workflow `E2E`) — the browser
  end-to-end suite against local emulators. Neither uses production secrets
  or deploys.
- **Vercel Preview** verifies deployment and render behavior in a real
  serverless build for each pull request, using the Preview
  environment's own configuration. Do not put production credentials
  into GitHub Actions; Vercel's Git integration owns Preview and
  production deploys.

Merging to `main` triggers the production deployment.

### Release policy

Application versions are intentional release snapshots, not per-merge
bumps — do not tag a version for every PR. The planned progression:

- `v0.9.0` — production-readiness code baseline: the application is
  ready to enter government-owned infrastructure migration,
  real-provider staging acceptance, and institutional handover work.
- Later `v0.9.x` releases only when another intentional baseline
  snapshot is warranted.
- `v1.0.0-rc.N` — government-owned infrastructure assembled and final
  staging/acceptance underway.
- `v1.0.0` — government production handover/acceptance complete.

A release is an annotated Git tag (e.g. `git tag -a v0.9.0 <sha>`) on a
merged `main` commit plus a matching GitHub Release; that tag is the
canonical application release identity. `v0.9.0` does not mean
government production handover is complete — the remaining
infrastructure, acceptance, and handover gates are the open Government
Production Readiness milestone issues (#56–#63, #83, #90). See
[`CHANGELOG.md`](./CHANGELOG.md) for release contents.

## Continuous integration and branch protection

CI is defined in `.github/workflows/ci.yml` (workflow **CI**, job
**verify**). See [`TESTING.md`](./TESTING.md) for exactly what it runs.
The GitHub PR "Checks" UI displays this as **`CI / verify`** (workflow name /
job name), but the branch-protection **status-check context** is the bare job
name **`verify`** (GitHub Actions). Use `verify` when configuring the ruleset.

Branch protection / rulesets are repository administration settings and
are not configured from code. The active `main` ruleset ("Protect Main"):

- Require a pull request before merging.
- Require **1** approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require the status-check contexts **`verify`** and **`playwright`** to pass
  (displayed as `CI / verify` and `E2E / playwright`).
- Block force pushes.
- Block branch deletion.

A merge queue and signed commits are intentionally omitted unless the
team decides it needs them. Note a status-check context only appears in
the ruleset picker after the workflow has run at least once on the
repository (merge a workflow first, then add the rule).

### End-to-end tests (`E2E / playwright`)

The browser end-to-end suite runs as a **separate** GitHub Actions workflow
(`.github/workflows/e2e.yml`, workflow **E2E**, job **playwright**), kept apart
from the `verify` gate because it needs Firebase emulators, a browser download,
and a built+served app. It uses only local emulators and synthetic data — **no
production secrets**. See [`TESTING.md`](./TESTING.md) "End-to-end tests
(Playwright)". Its status-check context is **`playwright`** (displayed
`E2E / playwright`).

`playwright` **is** a required status-check context in the current "Protect Main"
ruleset, alongside `verify`. If you ever need to make the E2E gate temporarily
non-blocking (e.g. while stabilizing it), remove the `playwright` context from
the ruleset deliberately — it is required by default.

## External services

| Service | Purpose |
| --- | --- |
| Vercel | Hosting, serverless functions, and the nightly continuity-report cron. |
| Firebase | Authentication, Firestore (data), Firebase Storage (photos, planned). |
| Resend | Sending the continuity-report email. |
| Meta (Facebook Login) | Optional resident/staff sign-in provider. |
| Meta (WhatsApp Business Platform / Cloud API) | Resident WhatsApp ordering. |
| DNS | A verified sending domain in Resend requires DNS records at your domain registrar; Vercel's default `*.vercel.app` domain requires no DNS setup, a custom domain does. |

Production deployments should use accounts, API keys, sending domains,
and project memberships controlled by the Public Entity Saba or its
authorized technical administrators. Avoid relying on personal accounts
or credentials belonging to an individual developer for ongoing
government operation; if a handover is still in progress, document who
holds each credential and the planned transfer so ongoing operation does
not depend on one person.

## Environment variables

Never commit real values. Copy `.env.example` to `.env.local` for local
development and configure the same variables in Vercel (Project
Settings → Environment Variables) for production.

### Canonical configuration table

This table is the single canonical reference for every environment variable the
application consumes. It mirrors the machine-readable registry in
[`src/lib/config/serverConfig.ts`](../src/lib/config/serverConfig.ts) (issue #54,
[ADR 0016](./adr/0016-centralized-configuration-model.md)) — keep the two in sync
when adding a variable. **Class:** `public` = build-time inlined and visible in
the browser bundle (safe by design); `server` = server-only non-secret;
`secret` = server-only and must never reach the browser, logs, or diagnostics.
**Required in:** `feature` means required only once that integration is enabled
(any one of its variables set). **Redeploy?** On Vercel every env change needs a
redeploy to take effect; `build` marks values additionally **inlined into the
build** (client/CSP), so they cannot be changed without rebuilding.

| Variable | Purpose | Class | Required in | Behavior if missing | Redeploy? |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client SDK | public | Production, Preview | Client renders "not configured" | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase client SDK / sign-in + CSP origin | public | Production, Preview | Client renders "not configured" | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase client SDK | public | Production, Preview | Client renders "not configured" | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase client SDK | public | optional | Unused today | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase client SDK | public | optional | Unused today | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase client SDK | public | Production, Preview | Client renders "not configured" | Yes (build) |
| `NEXT_PUBLIC_APP_URL` | Public origin for QR codes, PWA install, and email links | public | recommended (Production/Preview) | Falls back to the documented pilot origin; a malformed value also falls back | Yes (build) |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin SDK | server | Production, Preview | Server "not configured"; use throws a sanitized error → readiness `not_ready` | Yes |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase Admin SDK | server | Production, Preview | As above (validated as an email) | Yes |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase Admin SDK | **secret** | Production, Preview | As above (validated as a PEM key) | Yes |
| `FIREBASE_DATABASE_ID` | Named Firestore DB (disaster-recovery override) | server | optional | Uses the project's `(default)` DB; a malformed id throws a sanitized error on use | Yes |
| `CRON_SECRET` | Authorizes the continuity-report cron request | **secret** | Production | Route **fails closed** (503) | Yes |
| `RATE_LIMIT_HASH_SECRET` | HMAC salt for rate-limit bucket keys | **secret** | Production, Preview | Limiter **fails open** (allows + logs `rate_limit.secret_missing`); never hashes with a public salt | Yes |
| `CSP_REPORT_ONLY` | Emit `Content-Security-Policy-Report-Only` instead of enforcing | server | optional | CSP is **enforced** (the default) | Yes (build) |
| `RESEND_API_KEY` | Resend API key for outbound email (injected by the Vercel Resend integration in deployed envs) | **secret** | feature (email) | Email features disabled (best-effort, logged) | Yes |
| `CONTINUITY_REPORT_EMAIL_FROM` | Continuity-report sender (Resend-verified domain) | server | feature (email) | Continuity-report email disabled | Yes |
| `CONTINUITY_REPORT_EMAIL_TO` | Continuity-report recipients (comma-separated) | server | feature (email) | Continuity-report email disabled | Yes |
| `DELIVERY_CONFIRMATION_EMAIL_FROM` | Sender for delivery-review emails | server | optional | Falls back to `CONTINUITY_REPORT_EMAIL_FROM` | Yes |
| `ACCOUNT_SETUP_EMAIL_FROM` | Sender for account-setup invitations | server | optional | Falls back to `CONTINUITY_REPORT_EMAIL_FROM` | Yes |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API auth | **secret** | feature (whatsapp) | WhatsApp ordering disabled | Yes |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API number id | server | feature (whatsapp) | WhatsApp ordering disabled | Yes |
| `WHATSAPP_APP_SECRET` | Verifies inbound webhook signatures | **secret** | feature (whatsapp) | WhatsApp ordering disabled | Yes |
| `WHATSAPP_VERIFY_TOKEN` | Verifies the webhook subscription handshake | **secret** | feature (whatsapp) | WhatsApp ordering disabled | Yes |
| `LOG_LEVEL` | Minimum structured-log level (`debug`/`info`/`warn`/`error`) | server | optional | `info` in production, `debug` otherwise | Yes |

Ambient variables provided by the platform — `VERCEL_ENV`, `VERCEL_DEPLOYMENT_ID`,
`NODE_ENV`, `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` — are set by Vercel/Node and
are not configured by hand. The Vercel-managed Resend integration similarly
injects `RESEND_API_KEY` (consumed by the app) and `RESEND_EMAIL_DOMAIN`
(the verified sending domain — informational; the app deliberately uses the
explicit `*_EMAIL_FROM` identities instead). The emulator/test-only variables
(`FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, the
`NEXT_PUBLIC_FIREBASE_*_EMULATOR_HOST` values, demo project ids) **must never** be
set in a deployed Vercel environment — a hard guard in
[`src/lib/firebase/admin.ts`](../src/lib/firebase/admin.ts) refuses to run
emulator mode there.

Without the Firebase variables set, the app still builds and runs, showing a
clear "not configured" state instead of failing (CI builds with no secrets on
purpose). Without the email or WhatsApp variables set, those specific features
degrade gracefully (see [`INTEGRATIONS.md`](./INTEGRATIONS.md)) rather than
breaking the rest of the application. A **partially** configured integration (some
but not all of its variables set) is treated as a misconfiguration — the missing
variables become required — and is reported by the sanitized configuration status
in `serverConfig.getServerConfigStatus()`. `LOG_LEVEL` is optional; set it to
`debug` in Vercel and redeploy when investigating an issue, then remove it.

## Firebase

For transferring the Firebase/GCP project itself to Public Entity Saba
ownership (IAM, billing, service-account rotation, verification and
rollback), see the dedicated runbook:
[`FIREBASE_GCP_HANDOVER.md`](./FIREBASE_GCP_HANDOVER.md).

Deploy Firestore rules and indexes (and storage rules, if changed)
whenever they change:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

`firebase.json` points at `firestore.rules`, `firestore.indexes.json`,
and `storage.rules` in the repository root. Index changes can take
several minutes to build in Firestore after deploying; a query that
needs a not-yet-built index will fail until the build completes.

## Backup and disaster recovery

The full backup/restore strategy, runbook, RPO/RTO, and drills live in
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). Key deployment-time points:

- **Backups are not enabled by the application.** A project administrator must
  enable the recommended managed protections once, in the Google Cloud/Firebase
  console or with `gcloud`, after reviewing cost (**[OPERATOR ACTION REQUIRED]**):

  ```bash
  # Point-in-time recovery (7-day window)
  gcloud firestore databases update --database='(default)' --enable-pitr \
    --project=saba-water-delivery
  # Daily scheduled backup, 14-day retention
  gcloud firestore backups schedules create --database='(default)' \
    --recurrence=daily --retention=14d --project=saba-water-delivery
  ```

- **Firebase Auth is backed up separately** from Firestore
  (`firebase auth:export`/`auth:import`). Auth exports contain password hashes
  and PII — never commit them, log them, or put them in CI artifacts.
- **Firebase Storage** carries no production data yet (deny-by-default rules, no
  Storage code); enable object versioning when property/proof photos ship.
- **Environment variables are the recovery gap not covered by any Firestore
  backup.** Their authoritative copies live in Vercel and the vendor consoles;
  the required names and their recovery/rotation notes are in the
  "Environment variables" section above and in `DISASTER_RECOVERY.md` §10. Do
  not build a secrets-backup file.
- Verify a restore works with the read-only validator (`npm run verify:recovery`)
  and a quarterly restore drill into an emulator or isolated/test project —
  **never** against production in place.

## Vercel

The live production pilot uses
`https://saba-water-delivery.vercel.app`. Set `NEXT_PUBLIC_APP_URL` to that
exact origin in the Vercel production environment. The PWA install QR codes are
generated from this value, so do not use a branch-specific preview deployment
URL. When the permanent DNS name is configured, update the variable, redeploy,
verify `/driver/install` and `/resident/install`, and reprint the admin QR
codes.

Deploying is a normal Vercel Git-integrated deployment — pushing to the
production branch triggers a build (`npm run build`, which uses
webpack; see [`TECHNICAL.md`](../TECHNICAL.md) for why Turbopack is not
used). Set all environment variables in Vercel Project Settings before
the first deploy that needs them; changing an environment variable
requires a redeploy to take effect.

### Node.js version

Production runs on **Node.js 24.x**. This is pinned so local development,
CI, and production all agree:

- `.nvmrc` (`24`) drives local `fnm`/`nvm` and GitHub Actions.
- `package.json` `engines.node` (`24.x`) is what Vercel reads to select
  the runtime; the `24.x` pin keeps it on the Node 24 major (a future
  Node 25/26 will not be picked up automatically).

Keep Vercel Project Settings → Node.js Version consistent with these
(24.x). If you ever change the Node major version, change `.nvmrc`,
`engines`, and the Vercel setting together and re-run `npm run check`
and `npm run test:rules` — the runtime major is what production actually
executes on, so do not change it casually.

## Security headers and CSP

All browser security headers — Content-Security-Policy, Cross-Origin-Opener-Policy,
Referrer-Policy, X-Frame-Options, X-Content-Type-Options, Permissions-Policy,
and HSTS — are generated by `src/lib/security/headers.ts` and applied for every
route by `next.config.ts`. This is the single source of truth; see
[`../TECHNICAL.md`](../TECHNICAL.md) "Browser security headers / CSP" for the
full directive-by-directive rationale.

Deployment-relevant points:

- The policy is computed at **build time** from the environment, so Vercel's
  Production and Preview builds each get the right variant automatically
  (Preview additionally allows the Vercel preview toolbar; Production is
  strict, with no `'unsafe-eval'` and no wildcards).
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` must be set at build time (it already is,
  for Firebase to work) — the CSP derives the allowed Firebase auth origin from
  it.
- **`CSP_REPORT_ONLY`** (optional): set it to any truthy value in Vercel to emit
  `Content-Security-Policy-Report-Only` instead of enforcing — a cautious
  rollout where violations appear in the browser console but nothing is blocked.
  Leave it unset to enforce (the default). It is read at build time, so changing
  it requires a redeploy. There is intentionally no external CSP reporting
  vendor.
- **HSTS** is `max-age=31536000; includeSubDomains`, no `preload`. Do not add
  `preload` while the site is on `*.vercel.app` (that domain is not ours to
  submit); revisit when a custom government domain is configured.
- **COOP** is `same-origin-allow-popups` and **COEP is not set** — required for
  the Firebase Google sign-in popup.

### Manual preview smoke test (required before merging a header change)

CSP failures are runtime/browser failures, so verify on a Vercel **Preview**
deployment (open the browser devtools Console + Network). The separate
Playwright CI suite exists (see TESTING.md), but its emulator-based login
does not verify live Google OAuth or deployment-specific CSP behavior:

1. Homepage loads; **no CSP violations** in the console.
2. Resident login page loads; the Google sign-in **popup opens and completes**
   with a safe test account, the session establishes, and the resident portal
   loads.
3. Logout works and returns to the login page.
4. A dispatcher/admin account loads the dispatcher/admin portal.
5. The continuity-report and Delivery Run **PDF links download** correctly.
6. No legitimate image/font/style/script/manifest resource is blocked (check
   the Network tab for CSP-blocked requests).
7. API calls (session establishment, WhatsApp webhook) function normally.
8. GA4 is not expected to load (it is not integrated yet); if/when it is added,
   confirm its requests succeed and add its origins to the CSP first.

If the Google popup fails with a COOP/opener error, or a legitimate resource is
blocked, fix the specific directive in `headers.ts` (or temporarily set
`CSP_REPORT_ONLY` to unblock while diagnosing) — never widen the policy with a
wildcard to make a symptom disappear.

## Rate limiting

Abuse-sensitive operations are rate limited server-side (see
[`../TECHNICAL.md`](../TECHNICAL.md) "Rate limiting" and
[`OPERATIONS.md`](./OPERATIONS.md)). Two deployment points:

### `RATE_LIMIT_HASH_SECRET` (required in deployed environments)

Rate-limit identifiers (e.g. IPs) are HMAC-hashed before being used as Firestore
keys so a raw identifier is never stored or reversible. Because this repository
is **public**, there is no built-in salt that could protect a small-space value
like an IP, so this secret is **required in every deployed Vercel environment**:

- Set `RATE_LIMIT_HASH_SECRET` on **Production and Preview** (each its own unique
  random value, `openssl rand -hex 32`) in Vercel Project Settings → Environment
  Variables.
- If it is **missing** in a deployed environment the limiter treats itself as
  unavailable and **fails open** — it logs a high-severity
  `rate_limit.secret_missing` operational event and allows the request. It never
  blocks sign-in or water delivery just because the config is missing, and it
  never hashes with a repo-known salt. (So a missing secret means rate limiting
  is effectively OFF until you set it — search the logs for
  `rate_limit.secret_missing` to catch this.)
- **Local development and automated tests** need no secret: they use a
  deterministic dev-only fallback, which is **not** a production privacy control.

It is a **secret** (never commit a real value). Rotating it just resets in-flight
limiter windows (harmless — they re-fill). Do not reuse `CRON_SECRET`, the
Firebase private key, or any WhatsApp/Resend secret for it.

### Firestore TTL for `rateLimits` (one-time, manual)

Limiter counters live in the Firestore `rateLimits` collection, each with an
`expiresAt` timestamp. Configure a **TTL policy** on that field once so Firestore
reclaims expired documents automatically:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits --enable-ttl
```

(Or Firebase Console → Firestore → the `rateLimits` collection → TTL.) This is a
housekeeping optimization only: **the app is correct even if TTL is never
configured** — an elapsed window is always treated as fresh on read, so no user
is ever blocked by a stale document; the collection would just retain a small
number of inactive counters (negligible at Saba's scale).

## Health and readiness endpoints

Two lightweight, public-safe endpoints let operators, uptime monitors, and
deployment checks verify a deployment without exposing anything sensitive. Full
architecture in `TECHNICAL.md` "Health and readiness endpoints".

| Endpoint         | Question it answers                          | Healthy | Unhealthy                       |
| ---------------- | -------------------------------------------- | ------- | ------------------------------- |
| `/api/health`    | Is the app process/runtime responding?       | **200** | (only if the runtime is down)   |
| `/api/readiness` | Can the app serve (Firebase/Firestore up)?   | **200** | **503** when Firestore is down  |

- **Liveness** (`/api/health`) has no dependencies and returns `{ "status":
  "ok" }`. It stays 200 even if Firestore/Resend/WhatsApp are down — that is how
  you tell "the app is down" apart from "a dependency is degraded".
- **Readiness** (`/api/readiness`) returns `{ "status": "ready", "checks": {
  "app": "ok", "firestore": "ok" } }` (200) or, when the app cannot reach
  Firestore, `{ "status": "not_ready", "checks": { "app": "ok", "firestore":
  "unavailable" } }` (**503**). A **503 here means "the app is up but cannot
  reach Firestore"** — investigate Firebase Admin configuration
  (`FIREBASE_ADMIN_*`) and Firestore availability, not the Next.js runtime.

**No new environment variables or secrets are required** — readiness reuses the
existing `FIREBASE_ADMIN_*` credentials. The probe is a single read-only
Firestore document `get` (path `_health/probe`); it **never writes**, so it
creates no data and needs no TTL/cleanup, and it is cheap enough to be polled
frequently.

Test them after a deploy (see also docs/OPERATIONS.md):

```bash
curl -i https://<deployment>/api/health
curl -i https://<deployment>/api/readiness
```

Or run the full non-destructive smoke check (issue #84 — health, readiness,
pages, security headers, PWA assets; GET-only, never mutates):

```bash
npm run smoke:production -- --url https://<deployment> --production
```

Expect `200` from both on a healthy deployment, an `x-request-id` header on each
response, and a body containing no configuration, credentials, or error detail.

**Vercel does not automatically consume these endpoints** for routing, health
gating, or deploy validation, and this project adds no such configuration. They
exist for operators, external uptime monitoring, and manual/deploy validation —
point an uptime monitor at `/api/health` (and `/api/readiness` if you want a
Firestore-dependent signal). They are **not** a replacement for the full
application smoke test in docs/TESTING.md. The endpoints are intentionally **not**
rate limited so probing stays reliable.

## Cron

`vercel.json` schedules the continuity report:

```json
{ "crons": [{ "path": "/api/cron/continuity-report", "schedule": "0 0 * * *" }] }
```

`0 0 * * *` is evaluated in UTC by Vercel, which is exactly 8:00 PM
Saba time year-round (Saba is a fixed UTC-4 with no daylight saving, so
this never needs seasonal adjustment). Vercel Cron Jobs on the Hobby
plan are limited to at most 2 per day per project and do not guarantee
exact-minute execution; the Pro plan removes that limit and guarantees
tighter scheduling. Confirm the project's actual Vercel plan before
relying on this schedule as a strict guarantee.

## Resend

Deployed environments use the **Vercel-managed Resend integration**
(Vercel → Integrations → Resend). The integration injects
`RESEND_API_KEY` into the project's environment variables automatically
— do not create or paste an API key by hand, and never commit it. The
integration also injects `RESEND_EMAIL_DOMAIN`, the sending domain it
verified; the application intentionally does not read that variable —
sender identity is configured explicitly through the `*_EMAIL_FROM`
variables below, which carry a display name and mailbox that a bare
domain cannot express.

Production sends from a domain verified in Resend (Resend → Domains) —
this is the expected configuration, not an interim workaround. Resend's
own `onboarding@resend.dev` sender is only useful for local development
before a domain has been verified, and should not be used once a
verified domain is configured.

1. Connect the Resend integration to the Vercel project and add/verify
   the sending domain in Resend (Resend → Domains, reachable from the
   integration), following Resend's DNS verification instructions with
   your domain registrar.
2. Confirm `RESEND_API_KEY` is present in Vercel as an
   integration-managed variable — no manual key step is needed.
3. Set `CONTINUITY_REPORT_EMAIL_FROM` to an address on the verified
   domain (for example, a `waterdelivery@` address on that domain).
4. Set `CONTINUITY_REPORT_EMAIL_TO` to a government distribution list
   or shared operational inbox, not a personal address.

For local development only, create a key at Resend → API Keys into
`.env.local`; before a domain is verified, `onboarding@resend.dev` can
stand in as `CONTINUITY_REPORT_EMAIL_FROM` so email sending can be
tested end-to-end.

## Meta/Facebook Login

Facebook is currently disabled in the login UI. The steps below describe
provider setup; a reviewed application change is also needed before users can
sign in with it. See [INTEGRATIONS.md](./INTEGRATIONS.md).

Facebook Login is configured as a Firebase Authentication provider
(Firebase Console → Authentication → Sign-in method → Facebook), which
requires a Meta App with the Facebook Login product added and its App
ID/App Secret entered into Firebase. The public `/data-deletion` page
in this application satisfies Meta's required "Data Deletion
Instructions URL" field in the Meta App's Facebook Login settings.

## WhatsApp

WhatsApp ordering is a future resident feature. The code and webhook exist,
but the configuration below is a launch prerequisite, not proof of current
production activation. See [INTEGRATIONS.md](./INTEGRATIONS.md) for status.

1. In the same or a separate Meta App, add the WhatsApp product.
2. Under WhatsApp → API Setup, obtain a Phone Number ID and an access
   token (a System User token for production, since the default test
   token expires after 24 hours).
3. Under App Settings → Basic, copy the App Secret.
4. Choose your own random verify token and set it both in Vercel and in
   the Meta webhook configuration (Meta does not generate this value).
5. After deploying, set the webhook Callback URL to
   `https://<your-domain>/api/webhooks/whatsapp` in Meta App Dashboard
   → WhatsApp → Configuration → Webhook, using the verify token from
   step 4, then click Verify and Save.
6. Subscribe to the `messages` webhook field — this application does
   not read any other field.

Moving from Meta's Development mode (test numbers only) to Live mode
(able to message any real WhatsApp number) requires Meta Business
Verification, which is a manual process in Meta Business Manager and
can take from a day to a few weeks. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for more on this distinction.
