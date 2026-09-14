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

- `GET /api/health` → 200 `ok`.
- `GET /api/readiness` → ready (Firestore reachable).
- `/` loads; login entry points render.
- `/login` renders; Google/email sign-in controls present; Facebook button
  disabled.
- PWA/static assets load if relevant (`manifest`, icons, service worker).
- Security headers present on a page response (CSP — see
  `health-security.spec.ts` for the local equivalent).
- Authenticated probe **only** with a designated, separately configured
  smoke-test account, and only if explicitly approved — otherwise skip.

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

No automated production smoke runner exists today. When one is built it
must encode only the non-destructive checklist above; the prohibition list
is a hard requirement, not a convention.

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
