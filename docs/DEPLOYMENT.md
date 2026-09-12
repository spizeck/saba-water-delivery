# Deployment

How to reproduce and configure the production deployment. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for what each external service
is used for and its failure impact.

## Release flow

Changes reach production through this path:

```
feature branch
  → pull request
  → automated checks (GitHub Actions: CI / verify)
  → Vercel Preview deployment
  → human review
  → merge to main
  → production deployment (Vercel)
```

The two automated layers verify different things and are both required
in practice:

- **GitHub Actions (`CI / verify`)** verifies code correctness — lint,
  typecheck, unit/domain tests, the production build (including the
  PDFKit trace verification), and the Firestore/Storage rules tests. It
  uses no production secrets and does not deploy.
- **Vercel Preview** verifies deployment and render behavior in a real
  serverless build for each pull request, using the Preview
  environment's own configuration. Do not put production credentials
  into GitHub Actions; Vercel's Git integration owns Preview and
  production deploys.

Merging to `main` triggers the production deployment.

## Continuous integration and branch protection

CI is defined in `.github/workflows/ci.yml` (workflow **CI**, job
**verify**). See [`TESTING.md`](./TESTING.md) for exactly what it runs.
The stable required-check name is **`CI / verify`**.

Branch protection / rulesets are repository administration settings and
are not configured from code. Recommended ruleset for `main` (configure
in GitHub → Settings → Rules → Rulesets):

- Require a pull request before merging.
- Require **1** approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require the status check **`CI / verify`** to pass.
- Block force pushes.
- Block branch deletion.

A merge queue and signed commits are intentionally omitted unless the
team decides it needs them. Note the required-check name only appears in
the ruleset picker after the workflow has run at least once on the
repository (merge this workflow first, then add the rule).

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

### Public Firebase configuration (safe to expose to the browser)

| Variable | Purpose | Where obtained |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client SDK config | Firebase Console → Project settings → General → Your apps → Web app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase client SDK config | Same as above |

### Server secrets (never expose to the browser)

| Variable | Purpose | Secret? | Where obtained | Configured where |
| --- | --- | --- | --- | --- |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin SDK | No | Service account JSON | Vercel + `.env.local` |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase Admin SDK | No | Service account JSON | Vercel + `.env.local` |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase Admin SDK | **Yes** | Service account JSON (Firebase Console → Project settings → Service accounts → Generate new private key) | Vercel + `.env.local` |
| `CRON_SECRET` | Authorizes the nightly continuity-report cron request | **Yes** | Generate yourself (`openssl rand -hex 32`) | Vercel only |
| `RESEND_API_KEY` | Sends the continuity-report email | **Yes** | Resend dashboard → API Keys | Vercel + `.env.local` (if testing email locally) |
| `CONTINUITY_REPORT_EMAIL_FROM` | Sender address for the continuity report | No | Must be on a domain verified in Resend | Vercel + `.env.local` |
| `CONTINUITY_REPORT_EMAIL_TO` | Recipient list for the continuity report (comma-separated) | No | Government distribution list or shared operational inbox | Vercel + `.env.local` |
| `DELIVERY_CONFIRMATION_EMAIL_FROM` | Optional sender for resident delivery-review messages; falls back to `CONTINUITY_REPORT_EMAIL_FROM` | No | Must be on a domain verified in Resend | Vercel + `.env.local` |
| `WHATSAPP_ACCESS_TOKEN` | Authorizes outbound Meta Graph API calls | **Yes** | Meta App Dashboard → WhatsApp → API Setup (or a System User token) | Vercel + `.env.local` |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifies which Cloud API number sends/receives messages | No | Meta App Dashboard → WhatsApp → API Setup | Vercel + `.env.local` |
| `WHATSAPP_APP_SECRET` | Verifies inbound webhook signatures | **Yes** | Meta App Dashboard → App Settings → Basic | Vercel + `.env.local` |
| `WHATSAPP_VERIFY_TOKEN` | Verifies the webhook subscription handshake | **Yes** (chosen by you) | Generate yourself (`openssl rand -hex 32`) | Vercel **and** Meta App Dashboard webhook configuration |

Without the Firebase variables set, the app still builds and runs,
showing a clear "not configured" state instead of failing. Without the
continuity-report or WhatsApp variables set, those specific features
degrade gracefully (see [`INTEGRATIONS.md`](./INTEGRATIONS.md)) rather
than breaking the rest of the application.

### Optional operational configuration

| Variable | Purpose | Secret? | Default |
| --- | --- | --- | --- |
| `LOG_LEVEL` | Minimum level for structured operational logs (`debug`, `info`, `warn`, `error`). | No | `info` in production, `debug` otherwise |

`LOG_LEVEL` is **optional** — the app runs without it. Leave it unset for
normal operation (production logs at `info` and above, so it is not noisy).
Set it to `debug` in Vercel Project Settings → Environment Variables and
redeploy when you need verbose diagnostics while investigating an issue, then
remove it. Operational logs are captured by Vercel from the application's
output and are privacy-preserving by design; see `TECHNICAL.md`
("Operational logging and observability") and
[`OPERATIONS.md`](./OPERATIONS.md) for what they contain and how to use
request IDs to diagnose a failure.

## Firebase

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
deployment (open the browser devtools Console + Network) — there is no
automated browser test in CI yet (that arrives with the Playwright work in
issue #34):

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

Production sends from a domain verified in Resend (Resend → Domains) —
this is the expected configuration, not an interim workaround. Resend's
own `onboarding@resend.dev` sender is only useful for local development
before a domain has been verified, and should not be used once a
verified domain is configured.

1. Add and verify your sending domain in Resend (Resend → Domains),
   following Resend's DNS verification instructions with your domain
   registrar.
2. Create an API key (Resend → API Keys) and set it as
   `RESEND_API_KEY` in Vercel (never commit it).
3. Set `CONTINUITY_REPORT_EMAIL_FROM` to an address on the verified
   domain (for example, a `waterdelivery@` address on that domain).
4. Set `CONTINUITY_REPORT_EMAIL_TO` to a government distribution list
   or shared operational inbox, not a personal address.

For local development only, before a domain is verified,
`onboarding@resend.dev` can stand in as `CONTINUITY_REPORT_EMAIL_FROM`
so email sending can be tested end-to-end.

## Meta/Facebook Login

Facebook Login is configured as a Firebase Authentication provider
(Firebase Console → Authentication → Sign-in method → Facebook), which
requires a Meta App with the Facebook Login product added and its App
ID/App Secret entered into Firebase. The public `/data-deletion` page
in this application satisfies Meta's required "Data Deletion
Instructions URL" field in the Meta App's Facebook Login settings.

## WhatsApp

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
