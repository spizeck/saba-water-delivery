# 0005. Multi-role authorization and Driver Registry eligibility

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18;
  Driver Registry and Viewer role added 2026-08-18; records an existing decision;
  last-admin removal made concurrency-safe 2026-09-12, issue #48; invariant
  extended to all supported admin-reducing mutations 2026-09-13, issue #70)

## Context

The same person can play more than one part in a small island operation (a
dispatcher may also be a resident; an admin may cover dispatch). The system must
distinguish _who you are_ (authentication) from _what you may do_ (roles) from
_whether you may operationally deliver water_ (driver eligibility), and it must
not let holding the `driver` role by itself make someone an operational driver.

## Decision

- Users carry a **`roles` array** drawn from `resident`, `driver`, `dispatcher`,
  `admin`, and `viewer` (a read-only oversight role). **A user may hold multiple
  roles**; new users default to `["resident"]` (the baseline). When a user has
  more than one role, the portal header shows a **role switcher**.
- Authorization is enforced server-side by `requireRole(...)`, which redirects an
  unauthenticated user to login and a wrong-role user to `/access-denied`.
- **Operational driver eligibility is separate from the `driver` role.** A
  government-managed **Driver Registry** entry, explicitly linked to a user
  account (`linkedUserId`) and marked eligible, is what makes someone an
  operational driver. The `driver` role only grants access to the driver portal;
  it does not create a registry entry or confer eligibility.
- **Admin safety constraints:** an admin cannot remove their own `admin` role,
  and the system-wide invariant "at least one **usable** administrator always
  remains" is enforced **inside the transaction** of every supported
  admin-reducing mutation. Each such mutation reads and writes one shared
  singleton invariant document (`systemInvariants/adminRole`) in the same
  transaction as its role change, giving Firestore one point of contention that
  serializes them against one another; the live admin set is read from the
  `users` query inside the transaction, not from a cached counter (so it cannot
  drift). The losing transaction is retried, re-reads the now-smaller admin set,
  and fails with `LAST_ADMIN`. This protocol composes across mutation types: a
  `removeRole` racing an admin-reducing `mergeUserAccounts`, or two such merges,
  cannot both succeed (see Operational implications).
  - **Usable vs. stale administrator.** `countAdmins()` counts `users`
    documents carrying `admin` (authorization data). For that count to mean
    "administrators who can actually sign in," the one mutation that destroys a
    login identity — `mergeUserAccounts`, which deletes the duplicate account's
    Firebase Auth identity — **revokes `admin` from that decommissioned duplicate
    document** in the same invariant transaction, and the merge's last-admin
    check counts both the canonical demotion and that duplicate revocation.
    Without this, a merged-away duplicate that kept `admin` would be a "phantom
    admin": counted, but unable to authenticate, so a merge could leave zero
    usable admins while appearing to leave one. An **effective/usable
    administrator** is therefore a `users` document holding `admin` whose login
    identity has not been decommissioned.
  - Historical sequence: originally (2026-08-18) the guard was a best-effort
    pre-transaction count that was **not** race-proof; issue #48 (2026-09-12)
    first made `removeRole` concurrency-safe with this protocol; issue #70
    (2026-09-13) extended the same protocol to `mergeUserAccounts`, including the
    duplicate-decommissioning ("phantom admin") case.
  - The guarantee covers **supported application mutations** only. It cannot
    protect against direct out-of-band privileged edits (Firebase Console,
    ad-hoc Admin SDK scripts), which bypass application code. One benign residual
    case is acknowledged, not prevented: an operator may deliberately pre-grant
    `admin` to an account that has not yet claimed a login (`authStatus`
    `unclaimed`) — a *pending* admin, recoverable by claiming the account, as
    opposed to a *destroyed* identity. This is distinct from the phantom above
    and is left as a documented nuance rather than blocked.

## Alternatives considered

- **A single role per user:** rejected — real staff wear multiple hats; forcing
  one role would mean duplicate accounts.
- **Deriving driver eligibility from the `driver` role:** rejected — eligibility
  is a government roster decision (with meters, cooldowns, archival) that must be
  controllable independently of app sign-in, and must not be self-granted.
- **Client-side role checks:** rejected — see [0003](./0003-server-authoritative-mutation-model.md);
  roles are re-read server-side from Firestore on every request.

## Consequences

- Three distinct concepts stay separate: authentication (0004), role
  authorization (this ADR), and driver operational eligibility (Driver Registry).
- Driver identity has a deliberate split: the Registry document id is the
  government entity, while `linkedUserId` (a Firebase uid) is what appears on
  requests/offers, because claiming work requires an authenticated session (see
  TECHNICAL.md "Canonical Driver ID").
- The last-admin guard prevents lock-out of all administrative access, including
  under concurrency across mutation types: the invariant is enforced
  transactionally and serialized via the `systemInvariants/adminRole` document,
  so no combination of supported admin-reducing application mutations
  (`removeRole`, admin-demoting `mergeUserAccounts`) can leave the system with
  zero **usable** admins — a merged-away duplicate has its `admin` role revoked
  so it cannot linger as a counted-but-unusable "phantom admin."

## Operational implications

- Granting the `driver` role is not enough to let someone deliver — a linked,
  eligible Driver Registry entry (with meter assignments) is required.
- Restricting or archiving a driver is a Registry action, independent of their
  ability to sign in.
- Role/registry changes are recorded as durable audit events
  ([0010](./0010-audit-events-vs-application-logs.md)).
- **Last-admin invariant ([#48](https://github.com/spizeck/saba-water-delivery/issues/48)
  then [#70](https://github.com/spizeck/saba-water-delivery/issues/70)):** the
  check is enforced **inside** the transaction of every supported admin-reducing
  mutation and serialized through the shared `systemInvariants/adminRole`
  singleton (read and written in the same transaction as the role change), so no
  combination can leave zero admins. The losing transaction is retried by the
  Admin SDK and rejected with `LAST_ADMIN`.
  - **#48 (2026-09-12)** first made concurrent `removeRole` admin removals safe.
  - **#70 (2026-09-13)** extended the *same* protocol to `mergeUserAccounts`. A
    merge reduces the usable admin population in two ways, both now inside the
    protocol: (a) demoting the canonical out of `admin` (any union merge of an
    admin canonical, or an explicit merge dropping `admin`); and (b)
    **decommissioning the duplicate** — the merge deletes the duplicate's Auth
    identity, so if the duplicate carried `admin` the merge **revokes** it from
    the leftover duplicate document (the "phantom admin" fix) and counts that
    revocation in the check. So a merge racing a `removeRole`, two admin-reducing
    merges racing, or a single merge that would demote the canonical while its
    only "remaining" admin is the duplicate being decommissioned, all fail closed.
  - Proven by emulator-backed regression tests
    (`adminRoleConcurrency.emulator.test.ts` for #48,
    `adminInvariantCrossMutation.emulator.test.ts` for cross-operation races,
    `phantomAdmin.emulator.test.ts` for the duplicate-decommissioning case).
    Paths that cannot reduce the admin population — `addRole`, staff
    registration (resident/driver only), and Driver-Registry link/unlink (which
    only touch the `driver` role) — are outside the protocol by construction.
  - **Scope:** the guarantee covers **supported application mutations**. It does
    not — and cannot — protect against direct out-of-band privileged edits
    (Firebase Console, ad-hoc Admin SDK scripts) that bypass application code.

## References

- [`src/lib/auth/roles.ts`](../../src/lib/auth/roles.ts),
  [`src/lib/auth/session.ts`](../../src/lib/auth/session.ts) (`requireRole`)
- [`src/lib/domain/driverRegistry.ts`](../../src/lib/domain/driverRegistry.ts),
  [`src/app/admin/actions.ts`](../../src/app/admin/actions.ts) (admin guards)
- [`src/lib/domain/admin.ts`](../../src/lib/domain/admin.ts) (`removeRole`; the
  shared last-admin invariant protocol — `readAdminPopulationInTransaction`,
  `recordAdminInvariantParticipation` — over `systemInvariants/adminRole`)
- [`src/lib/domain/identity.ts`](../../src/lib/domain/identity.ts)
  (`mergeUserAccounts`, which joins the protocol when it demotes an admin)
- [`src/components/layout/PortalHeader.tsx`](../../src/components/layout/PortalHeader.tsx) (role switcher)
- TECHNICAL.md "Roles", "Role vs Eligibility (Drivers)", "Driver Registry"
