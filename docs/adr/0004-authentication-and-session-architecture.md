# 0004. Authentication and session architecture

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-17/18;
  records an existing decision)

## Context

The app must authenticate residents and staff, then let the trusted server
re-verify identity on every request without trusting a client-supplied token or
role on each call. It also needs a browser-drivable sign-in for automated E2E
tests without exposing an auth bypass.

## Decision

- The **browser authenticates with Firebase Authentication** (Google or
  email/password; Facebook is scaffolded but disabled — "Coming Soon" — pending
  Meta verification).
- The client exchanges its Firebase **ID token** for a session by POSTing it to
  **`/api/auth/session`**. The server verifies the ID token with the Admin SDK,
  ensures a `users/{uid}` profile exists (new users default to `["resident"]`),
  and mints a **Firebase session cookie** set as an **httpOnly** cookie.
- Every server-rendered request re-verifies that session cookie with the Admin
  SDK and re-reads the user's roles from Firestore (`getSessionUser` /
  `requireRole`). The browser never asserts its own roles.
- **There is no authentication bypass for E2E.** Tests drive the real login form
  with email/password against the Firebase Auth **emulator**; only the identity
  provider is the emulator instead of live Google (see
  [0013](./0013-testing-and-release-gates.md)).

## Alternatives considered

- **Trusting the Firebase ID token on every API call (no session cookie):**
  workable, but a session cookie is httpOnly (not readable by JS), integrates
  with server-rendered navigation, and lets the server revoke/verify centrally.
- **A custom auth system / custom JWTs:** rejected — more to secure than Firebase
  Auth for no benefit at this scale.
- **A test-only auth bypass for E2E:** explicitly rejected — it would weaken the
  real auth path; the emulator approach exercises the true flow.

## Consequences

- The session cookie is the credential the server verifies; the server
  authorization decision is made from Firestore-stored roles, not client claims.
- Cookie `secure` is set in production; the emulator/E2E build serves over http
  on localhost, which browsers treat as a secure context.
- Auth users are **not** part of a Firestore backup and are recovered separately
  ([0014](./0014-backup-and-disaster-recovery-strategy.md) §Auth).

## Operational implications

- If Firebase Auth is degraded, sign-in and all authenticated actions stop; data
  is unaffected (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)).
- Restored Auth users and Firestore `users/{uid}` records must stay aligned by
  `uid`, and account-merge semantics must be preserved
  ([0014](./0014-backup-and-disaster-recovery-strategy.md) §Auth).

## References

- [`src/app/api/auth/session/route.ts`](../../src/app/api/auth/session/route.ts),
  [`src/lib/auth/session.ts`](../../src/lib/auth/session.ts)
- [`src/app/login/LoginForm.tsx`](../../src/app/login/LoginForm.tsx),
  [`src/lib/auth/AuthProvider.tsx`](../../src/lib/auth/AuthProvider.tsx)
- TECHNICAL.md "Authentication"; [`../TESTING.md`](../TESTING.md) (E2E auth)
- Related: [0003](./0003-server-authoritative-mutation-model.md),
  [0005](./0005-multi-role-authorization-and-driver-eligibility.md)
