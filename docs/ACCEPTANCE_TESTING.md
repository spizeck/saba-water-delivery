# Acceptance Testing — Staging and Production Smoke

This document defines the two verification boundaries **beyond** local/CI
automation: government staging acceptance and the non-destructive
production smoke check. For how tests run locally and in CI, see
[TESTING.md](TESTING.md). For what each environment is expected to prove,
see [PRODUCTION_READINESS_TEST_MATRIX.md](PRODUCTION_READINESS_TEST_MATRIX.md).

## The three environments

| Environment | Purpose | External services |
|---|---|---|
| Local / CI | All automated verification: unit, emulator, rules, action, and Playwright suites | Firebase emulators, injected/fake providers only — **no production credentials, no real providers, no real data** |
| Government staging (future) | Real-provider acceptance against government-owned infrastructure | Real Google OAuth, real Resend delivery to designated test recipients, deployed security rules |
| Production | Post-deployment liveness only | Read-only probes; **no operational mutation ever** |

## 1. Local / CI (current)

Everything marked `verified` in the matrix runs here: domain logic,
Firestore transactions, Security Rules, auth flows via the Auth emulator,
route/action authorization, notification outbox behavior with a fake
provider, and the Playwright suite. The E2E suite is structurally prevented
from targeting anything except local emulators (`e2e/support/safety.ts`,
verified by `e2e/support/__tests__/safety.test.ts`). CI requires no secrets.

## 2. Government staging / acceptance (future)

A staging environment is required to prove the boundaries that local
emulators structurally cannot. **Prerequisites are tracked in existing
issues** — government-owned Firebase project (#56), government-owned Vercel
(#57), government-owned Resend domain (#58). Do not provision staging
resources ad hoc; they arrive through those issues.

### Scope

Staging uses **synthetic accounts only** — designated test users and
designated test email recipients, never real resident data.

### Acceptance checklist

Once staging exists, an acceptance run verifies:

**Authentication**

- Real Google sign-in completes and lands on the correct portal.
- The session cookie is httpOnly and expires per configuration.
- Sign-out clears the session.
- A user without a role is denied the matching portal (`/access-denied`).
- Driver sign-in without a linked Driver Registry entry is denied.
- Authorized-domain / callback configuration matches the staging origin
  (no localhost or preview URLs in production config).

**Email delivery (Resend)**

- A delivery-confirmation email actually arrives at a designated test
  recipient and its Review Delivery link resolves to the staging origin.
- A continuity report email arrives at the designated staff recipient.
- Retry behavior is observable: a transient provider failure leaves the
  outbox notification pending and a later worker pass delivers it.
- No email is sent to any address outside the designated test recipients.

**Security rules as deployed**

- The rules deployed to the staging project match the repository
  `firestore.rules` / `storage.rules` (diff or `firebase deploy --dry-run`
  parity check — not just "rules pass tests locally").

**Operational smoke**

- `GET /api/health` → 200.
- `GET /api/readiness` → ready against the staging project.
- Cron endpoints reject calls without `Authorization: Bearer $CRON_SECRET`.
- The notification outbox worker runs on schedule (cron delivery visible in
  logs; no PII in log output).

**Operational workflow (synthetic data)**

- A full dispatcher→driver→resident flow with synthetic accounts: create a
  request, assign/accept, record collection, mark delivered, resident
  confirms or staff records a dispute, dispute resolves.

### What staging must NOT contain

- No real resident profiles, phone numbers, or delivery addresses.
- No production data copies.
- No live WhatsApp/Meta or Facebook provider wiring (disabled features —
  see the matrix).

## 3. Production smoke (non-destructive)

The production smoke check answers "did the deployment come up and are its
public edges alive?" — nothing more. It is safe to run after every deploy.

### Checklist

The runner (`scripts/production-smoke.mjs`, see "Automation" below)
verifies:

- `GET /api/health` → 200 `{"status":"ok"}` (liveness only — it deliberately
  proves nothing about dependencies).
- `GET /api/readiness` → 200 `{"status":"ready","checks":{"app":"ok",
  "firestore":"ok"}}`. A 503 / `not_ready` is a smoke FAIL: it is the
  endpoint's designed "Firestore unreachable" signal.
- `GET /` → 2xx and the page identifies the application ("Saba Water
  Delivery"), so a generic error shell cannot pass.
- `GET /login` → 2xx, identifies as the login page, and is NOT in the
  "Sign-in is not configured yet" state that renders when the deployment is
  missing `NEXT_PUBLIC_FIREBASE_*` — a real misconfiguration this check
  catches. **Scope note:** the provider controls are client-hydrated
  (`LoginForm` server-renders a loading state until Firebase Auth resolves),
  so "Google button present / Facebook disabled" cannot be asserted over
  plain HTTP — that boundary is covered by `e2e/tests/auth.spec.ts` locally
  and by staging acceptance (#83) with a real provider.
- Security headers on the `/` response — the actual production contract from
  `src/lib/security/headers.ts`: a non-empty enforcing (or report-only) CSP
  containing `default-src 'self'` and `frame-ancestors 'none'` and never
  `'unsafe-eval'`/`localhost`, plus `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`,
  `X-Frame-Options: DENY`, `Permissions-Policy`, and (production targets
  only) `Strict-Transport-Security`.
- PWA assets: `GET /manifest.json` → 200 naming "Saba Water Delivery";
  `GET /sw.js` → 200 served as JavaScript.
- Authenticated probe **only** with a designated, separately configured
  smoke-test account, and only if explicitly approved — **not implemented**;
  no such account exists and none is created.

### Explicitly prohibited in production

The smoke check must NEVER:

- create, modify, or delete water requests;
- create or alter resident, driver, dispatcher, admin, or viewer records;
- send email or trigger the notification outbox;
- mutate driver state (online/offline, registry, meters, locks);
- mutate dispatch state (requests, offers, runs, priorities);
- modify roles, dispatch configuration, or any admin surface;
- invoke cron endpoints (even "read-only" ones can trigger sends);
- run the integrity diagnostics against production casually — those are
  deliberate maintainer tools requiring `--production` (see
  `scripts/production-integrity.mjs` and [OPERATIONS.md](OPERATIONS.md)).

If any of the above needs production verification, it belongs in a
controlled acceptance exercise with explicit approval — not in the smoke
suite.

### Automation

`scripts/production-smoke.mjs` implements this checklist. It is a
standalone operator CLI — never part of `npm run check`, the test suites,
or CI.

```bash
npm run smoke:production -- --url https://<deployment-origin> --production
```

- **`--url` is always required.** The runner never defaults a target from
  the environment, repository config, `NEXT_PUBLIC_APP_URL`, or Vercel
  state — the operator names the exact origin being probed.
- **`--production` is required for any non-local target.** Without it the
  runner accepts only loopback targets (for verifying the runner itself
  against a local `next start`). This mirrors the fail-closed
  acknowledgement of `scripts/production-integrity.mjs` (#52).
- **Target validation is fail-closed.** Malformed URLs, non-http(s)
  schemes, embedded credentials, fragments, query strings, path prefixes,
  non-default ports, localhost/loopback/private IP literals, and
  local-style hostnames are rejected. `--production` additionally requires
  plain `https:` on a public hostname — the current Vercel pilot hostname
  remains a permitted explicit target until the government domain lands in
  #59.
- **Read-only by construction.** Every probe is `GET` issued through a
  single code path; no other HTTP method exists in the runner, and no
  credentials or Firebase SDK are involved. Unit tests assert all issued
  requests are GET/HEAD.
- **Timeouts** — every request has an explicit timeout (`--timeout-ms`,
  default 10s); a timeout is a failed check, never a hang.
- **Redirects** — followed only within the same origin (max 5 hops); a
  cross-origin redirect is a FAIL, so `production → unrelated domain →
  200` can never pass.
- **Output** — one PASS/FAIL line per check with status and duration, then
  a summary. `--json` emits the sanitized machine-readable equivalent
  (check names, pass/fail, HTTP status, duration, failure category — never
  bodies, headers, or cookies).
- **Exit codes** — `0` all checks passed · `1` one or more checks failed ·
  `2` usage/target-validation error (nothing was probed).

Example against the current technical pilot (read-only, no auth, no
mutation):

```bash
npm run smoke:production -- --url https://saba-water-delivery.vercel.app --production
```

The pilot is **not** government production — the official target/domain is
established through #56/#57/#59, and the same command will take that
origin once it exists. Continuous uptime monitoring stays out of scope
here — it is #62; this runner is the post-deploy functional smoke.
Government staging acceptance remains #83.

## Terminology discipline

When reporting external-service verification, be precise:

- **adapter tested** — provider client mocked; proves our request/response
  handling only;
- **emulator tested** — local Firebase emulator; proves integration shape,
  not production config;
- **sandbox/integration tested** — real provider sandbox or test mode;
- **staging accepted** — verified against government-owned staging per the
  checklist above;
- **production smoke verified** — liveness only, post-deploy.

Never describe a mocked-adapter or emulator result as "production tested."
