# 0005. Multi-role authorization and Driver Registry eligibility

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18;
  Driver Registry and Viewer role added 2026-08-18; records an existing decision)

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
  and the system refuses to remove the last admin.

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
- The last-admin guard prevents accidental lock-out of all administrative access.

## Operational implications

- Granting the `driver` role is not enough to let someone deliver — a linked,
  eligible Driver Registry entry (with meter assignments) is required.
- Restricting or archiving a driver is a Registry action, independent of their
  ability to sign in.
- Role/registry changes are recorded as durable audit events
  ([0010](./0010-audit-events-vs-application-logs.md)).

## References

- [`src/lib/auth/roles.ts`](../../src/lib/auth/roles.ts),
  [`src/lib/auth/session.ts`](../../src/lib/auth/session.ts) (`requireRole`)
- [`src/lib/domain/driverRegistry.ts`](../../src/lib/domain/driverRegistry.ts),
  [`src/app/admin/actions.ts`](../../src/app/admin/actions.ts) (admin guards)
- [`src/components/layout/PortalHeader.tsx`](../../src/components/layout/PortalHeader.tsx) (role switcher)
- TECHNICAL.md "Roles", "Role vs Eligibility (Drivers)", "Driver Registry"
