# 0013. Testing strategy and release gates

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (CI quality gates added via #28; Playwright
  E2E added 2026-09-12 via #34; records existing decisions)

## Context

A government-handover system needs automated confidence that survives dependency
and framework upgrades, without ever risking production data in a test run and
without a slow/fragile single gate.

## Decision

- **Layered tests:**
  - **Vitest** for pure domain/unit logic (the bulk of the suite; no network,
    no emulator).
  - **Firebase emulator-backed rules tests** (`npm run test:rules`) that exercise
    `firestore.rules`/`storage.rules` against local emulators.
  - **Playwright E2E** (`npm run test:e2e`) driving the real app against
    **disposable Auth + Firestore emulators** with seeded synthetic data.
- **No production Firebase in automated tests, ever.** E2E and rules tests run
  only against local emulators. A mandatory safety guard refuses to run unless
  the emulator hosts are **loopback** (`127.0.0.1`/`localhost`/`[::1]` on the
  expected ports) and the project id is a **`demo-`** project; it also refuses in
  a deployed Vercel environment. E2E starts its own emulator-configured app
  server (`reuseExistingServer: false`) so it can never attach to an unrelated
  server pointed at real Firebase.
- **Two separate CI workflows**, each a required status check on `main`:
  - Workflow **`CI`**, job **`verify`** → runs lint, typecheck, unit tests,
    production build (with the PDFKit trace check), rules tests, and format check.
  - Workflow **`E2E`**, job **`playwright`** → installs Chromium and runs the
    Playwright suite against emulators.
- The heavier E2E suite is deliberately a **separate** gate from `verify` so a
  browser/emulator failure is easy to distinguish from a unit/build failure.

## GitHub check contexts (verified against the current ruleset)

The `main` branch ruleset ("Protect Main") requires two status-check contexts,
both provided by GitHub Actions: **`verify`** and **`playwright`** (the bare job
names). GitHub's PR "Checks" UI displays these as **`CI / verify`** and
**`E2E / playwright`** (workflow name / job name), but the ruleset matches on the
job-name context. When editing branch protection, use the contexts `verify` and
`playwright`. The ruleset also enforces pull-request review and conversation
resolution before merge; `main` is protected against force-push and deletion.

## Alternatives considered

- **One combined gate:** rejected — a slow/fragile E2E failure would block the
  fast core gate and obscure the cause.
- **A test-only auth bypass to simplify E2E:** rejected — E2E drives the real
  login flow against the emulator instead ([0004](./0004-authentication-and-session-architecture.md)).
- **Running E2E against a shared cloud test project:** rejected — disposable
  local emulators are safer (no cloud data, no cost) and the safety guard makes
  accidental production access impossible.

## Consequences

- Upgrades (Next.js, React, Firebase SDKs) are exercised end-to-end before merge.
- E2E needs a JVM (Firestore emulator) and a Chromium download in CI.
- The safety guard means a stale `FIRESTORE_EMULATOR_HOST` cannot silently pass a
  cloud validation, and tests cannot reach deployed Firebase.

## Operational implications

- **Dangerous assumption to preserve:** automated E2E/rules tests must **never**
  touch deployed Firebase — keep the loopback + `demo-` project guard and
  `reuseExistingServer: false`.
- If workflow or job names change, update the ruleset's required contexts to
  match the new job names, or required checks will silently stop matching.
- Do not weaken a test or a gate to make a PR pass.

## References

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (workflow `CI`,
  job `verify`), [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)
  (workflow `E2E`, job `playwright`)
- [`playwright.config.ts`](../../playwright.config.ts),
  [`e2e/support/safety.ts`](../../e2e/support/safety.ts) (loopback/demo guard),
  [`vitest.config.ts`](../../vitest.config.ts),
  [`vitest.rules.config.ts`](../../vitest.rules.config.ts)
- [`../TESTING.md`](../TESTING.md); [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
  "Continuous integration and branch protection"
