# 0003. Server-authoritative mutation model

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-17/18;
  records an existing decision)

## Context

Firestore can be written directly from the browser when security rules allow it.
This application enforces meaningful business rules (one active request per
resident, dispatch fairness, driver eligibility, the one-active-delivery lock,
audit trails) that cannot be expressed safely or completely in Firestore
security rules alone, and that must not be bypassable by a client.

## Decision

**All operational mutations go through trusted server code** (Next.js Server
Actions and API route handlers) using the **Firebase Admin SDK**. Client-side
Firestore is not used for data writes; browser access is denied by default in
`firestore.rules`. The browser talks to the app's own server, and the server —
after verifying the session and re-reading roles from Firestore — performs the
write with the Admin SDK.

Firestore security rules exist as **defense-in-depth for direct client access**,
not as the authorization boundary for the application's own operations.

## Alternatives considered

- **Client-side Firestore writes governed by security rules:** rejected. Complex
  invariants (fairness ordering, cross-document locks, idempotency, audit events)
  are impractical/unsafe to encode purely in rules, and a rules bug would be a
  direct data-integrity hole.
- **A mix of client and server writes:** rejected — two authorization models to
  keep consistent; easy to drift into an insecure state.

## Consequences

- Business rules live in one place (server domain logic), are testable, and are
  not reachable by a malicious client.
- **The Admin SDK bypasses Firestore security rules entirely.** Rules therefore
  do not — and are not meant to — constrain the application's own server writes.
- Because writes are server-side, the server session/role check is the real
  authorization boundary (see [0004](./0004-authentication-and-session-architecture.md),
  [0005](./0005-multi-role-authorization-and-driver-eligibility.md)).

## Operational implications

- **Dangerous assumption to preserve:** deploying **deny-all client Firestore
  rules is NOT a production write freeze.** Trusted server paths (server actions,
  the WhatsApp webhook, the continuity cron) keep writing through the Admin SDK
  regardless of client rules. To actually stop writes during a data incident,
  pause/disable the write-capable surfaces (Vercel deployment, webhook, cron) —
  see [`../DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) §6.3.
- A rules change cannot lock out the app itself; conversely, tightening rules
  only affects any (currently unused) direct client access.
- The database the Admin SDK targets is selectable via `FIREBASE_DATABASE_ID`
  (default `(default)`), which matters for recovery
  ([0014](./0014-backup-and-disaster-recovery-strategy.md)).

## References

- [`src/lib/firebase/admin.ts`](../../src/lib/firebase/admin.ts) (Admin SDK,
  `FIREBASE_DATABASE_ID`), [`firestore.rules`](../../firestore.rules) (deny-by-default)
- Server actions: `src/app/*/actions.ts`; API routes: `src/app/api/**`
- TECHNICAL.md "Server vs Client", "Firestore Security"
- Related: [0001](./0001-firebase-data-and-auth-platform.md),
  [0004](./0004-authentication-and-session-architecture.md)
