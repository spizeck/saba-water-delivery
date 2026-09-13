# 0016. Centralized, validated configuration boundary

- **Status:** Accepted
- **Date:** 2026-09-13 (issue #54)

## Context

The application depends on a growing set of environment variables across Firebase
(client + admin), Vercel, Resend email, cron, rate limiting, WhatsApp, the public
app URL, and recovery tooling. Each module knew what it needed, but there was no
single typed model that made it easy to detect a deployment that **built
successfully but was operationally incomplete or unsafe**, and some configuration
logic had drifted:

- the public app origin (`NEXT_PUBLIC_APP_URL`) was resolved in **three** places
  with inconsistent normalization (two stripped a trailing slash, one did not)
  and a hard-coded pilot fallback duplicated in each;
- "is this a deployed Vercel environment?" was re-derived from `VERCEL_ENV` in
  several modules;
- Firebase Admin credentials were only presence-checked, so an empty project id,
  a non-email `CLIENT_EMAIL`, or a private key missing its PEM header passed the
  check and failed deep inside the SDK;
- there was no sanitized, machine-readable summary of configuration state for a
  future admin diagnostics surface.

CI and Vercel builds intentionally run with **no** production secrets (the app
renders a "not configured" state), so configuration validation must not force
secrets to exist at build time.

## Decision

- **A small number of explicit, typed configuration boundaries — not one giant
  universal config object.** A new `src/lib/config/` module provides:
  - `validators.ts` — pure, dependency-free validators (required/optional string,
    http(s) URL → normalized origin, boolean flag, CSV list, Firestore database
    id, email, PEM private key). They operate on raw strings, so they are
    testable without the machine environment.
  - `errors.ts` — `ConfigError(variable, reason)` whose message contains the
    variable **name and a categorical reason only**, never the value.
  - `deployment.ts` — one pure, env-injectable resolver for the deployment target
    (`production` / `preview` / `test` / `development`), `isDeployed`, and
    `isEmulator`, replacing the scattered `VERCEL_ENV` checks.
  - `appOrigin.ts` — the single `getAppOrigin()` used for QR codes, PWA install
    links, and email links (validated, origin-normalized, one documented
    fallback).
  - `serverConfig.ts` (`server-only`) — a registry describing every server
    variable (classification, secret flag, required-level per environment) plus
    validated getters (`getFirebaseAdminConfig`, `getDatabaseId`) and
    `getServerConfigStatus()`, a **sanitized** `set|unset|invalid` +
    required-here summary that never exposes a value.

- **Fail clearly and early for required production configuration; do not silently
  fall back.** Required, malformed configuration is detected at the boundary with
  a sanitized error. The Firebase Admin credential/database id is validated when
  the trusted server is initialized (not at import), so a bad value fails on use
  with a precise, value-free `ConfigError` instead of an opaque SDK error.

- **Client and server configuration stay separate.** `firebase/client.ts`
  (public `NEXT_PUBLIC_*`) remains the client boundary; `serverConfig.ts` is
  `server-only`. Centralization never makes server configuration reachable from
  the browser.

- **Existing intentional semantics are preserved unchanged.** Rate limiting still
  **fails open** when its deployed secret/storage is unavailable ([0012](./0012-security-and-observability-baseline.md));
  optional integrations (Resend, WhatsApp) stay optional and never become
  readiness-critical ([0011](./0011-external-integration-failure-model.md),
  [0012](./0012-security-and-observability-baseline.md)); readiness is still
  Firestore-only. The config model makes state **explicit**; it does not make
  optional providers mandatory. A partially-configured integration (some but not
  all of its variables set) is distinguished from a disabled one: the remaining
  variables become `required` in the status summary.

- **A lightweight internal validator, not a runtime schema dependency.** The
  value a large validation library would add over these small pure functions does
  not justify the bundle/maintenance cost.

## Alternatives considered

- **One universal typed config object loaded at startup:** rejected — it would
  force every secret to exist at build/startup (breaking CI and the documented
  "not configured" dev state) and couple unrelated concerns. Small explicit
  boundaries validated on use fit the existing architecture better.
- **Adding a schema library (e.g. a runtime validator dependency):** rejected for
  this issue — the internal validators cover the needed checks with no new
  dependency; revisit only if configuration complexity grows materially.
- **Making `NEXT_PUBLIC_APP_URL` a hard build failure when unset in production:**
  rejected — it is a build-time public value and CI builds with nothing set.
  Instead it keeps a documented fallback and is surfaced as a status **warning**
  (recommended, not required) in a deployed environment.

## Consequences

- Maintainers have one canonical description of configuration (the registry +
  the table in [`../DEPLOYMENT.md`](../DEPLOYMENT.md)) and a sanitized status
  function for a future admin diagnostics surface.
- Malformed required configuration is caught early with value-free errors;
  secrets never appear in logs, errors, or the status summary.
- Some modules still read `process.env` directly, **by design** (documented here
  so it does not look like a violation):
  - `firebase/client.ts` — public `NEXT_PUBLIC_FIREBASE_*` and client emulator
    hosts (the client boundary; kept separate from server config, read at module
    scope for build-time inlining).
  - `firebase/admin.ts` — the emulator project-id fallback and the
    `isFirebaseAdminConfigured` presence booleans (Firebase-init concerns local to
    that module; credential **validation** goes through `serverConfig`).
  - `security/headers.ts` — a pure, injectable `readEnv(process.env)` for
    build-time CSP (already the model this ADR generalizes).
  - `logging/logger.ts` — `LOG_LEVEL` / ambient `NODE_ENV` / `VERCEL_ENV` /
    `VERCEL_DEPLOYMENT_ID`; logging is a foundational primitive that must not
    depend on the config module.
  - `security/rateLimit.ts` — the `RATE_LIMIT_HASH_SECRET` read inside the
    fail-open resolver (kept verbatim per [0012](./0012-security-and-observability-baseline.md))
    and the broader "behind Vercel at all" IP-trust check; the deployed-env check
    was centralized.
  - `email/*` and `whatsapp/clientConfig.ts` — feature readers that return `null`
    when incomplete (single-location per variable, each registered in the config
    registry).
  - the cron route (`CRON_SECRET`, fail-closed 503) and the session route
    (`NODE_ENV` cookie `secure`) — request-boundary reads.

## Operational implications

- **Dangerous assumption to preserve:** validation must never turn the rate
  limiter fail-open, or make optional integrations readiness-critical. It reports
  state; it does not change failure semantics.
- The canonical variable table lives in [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
  (name, purpose, secret/public, environments required, behavior when missing,
  redeploy required) and mirrors the `serverConfig.ts` registry — keep them in
  sync when adding a variable.

## References

- [`src/lib/config/`](../../src/lib/config) (validators, deployment, appOrigin,
  serverConfig), [`src/lib/firebase/admin.ts`](../../src/lib/firebase/admin.ts)
- [`../DEPLOYMENT.md`](../DEPLOYMENT.md) "Environment variables";
  TECHNICAL.md "Configuration model"
- [0011](./0011-external-integration-failure-model.md),
  [0012](./0012-security-and-observability-baseline.md),
  [0014](./0014-backup-and-disaster-recovery-strategy.md)
