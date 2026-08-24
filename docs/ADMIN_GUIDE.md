# Administrator Guide

This guide is for government administrators using the Admin portal
(`/admin`). No coding knowledge is required. For technical detail
behind any of this, see [`TECHNICAL.md`](../TECHNICAL.md).

## Users

`/admin` lists all user accounts with search/filter by name, email, or
role.

Opening a user shows their profile information, current roles, and
history.

**Roles you can add or remove here:** `viewer`, `dispatcher`, `admin`.

- `resident` is the baseline role every account has and cannot be
  removed.
- **Do not manually assign the `driver` role.** It is explained below
  under "Driver Registry" — attempting to add it from this screen is
  not offered, because becoming an operational driver is a government
  decision made through the Driver Registry, not a generic role grant.
- An admin cannot remove their own admin role, and the system will not
  let you remove the last remaining admin account. This prevents
  accidentally locking everyone out of administration.
- Every role change is recorded with who made it and when.

## Driver Registry

`/admin/drivers` is the government-managed roster of drivers. This is
separate from user accounts and separate from role management.

### Creating a driver

A driver can be added here with just a name (and optionally a phone
number) — no account or sign-in is required to create the registry
entry. This lets government record a driver before that person has
ever used the application.

### Linking a driver to a user account

Once a driver has signed into the application (creating a normal
account, the same way a resident would), open their registry entry and
use **Link Account**, searching by name, phone, or email.

**What linking does:**

- Grants that account the `driver` role automatically (their other
  roles, such as `resident`, are kept).
- Does **not** automatically make them eligible to deliver — eligibility
  is a separate decision (see below).
- An account can only ever be linked to one driver registry entry.

### Unlinking

An admin can unlink an account from its registry entry later.
Unlinking:

- Removes the `driver` role from that account.
- Forces the driver offline.
- Is blocked while the driver has an active claimed delivery — resolve
  or reassign that delivery first.
- Never deletes the registry entry or the driver's history.

### Eligibility

Eligibility (`eligible` / `ineligible`) determines whether a linked
driver may actually claim deliveries. This is independent of whether
they are online. Restrict a driver's eligibility for reasons such as
outstanding water payment or other administrative issues, and restore
it when resolved. Every restriction and restoration is recorded.

### Availability

Availability (`online` / `offline`) is set by the driver themselves and
is not something an admin changes directly.

### Fill station meters

Each driver has an independent meter code and number per fill station
(Bottom, W.W.S., Hells Gate). Edit these from the driver's detail page.
Changing one station's assignment does not affect the others.

### A driver can receive work only when all of the following are true

- A Driver Registry entry exists for them.
- Their account is linked to that entry.
- Their account has the `driver` role.
- Government has marked them eligible.
- They are online.
- They are not in a decline cooldown.

## Dispatch settings

`/admin` includes dispatch-offer settings:

- **Maximum declines per day** — how many delivery offers a driver may
  decline in one day before new offers pause for them. Default: 3.
- **Decline cooldown hours** — how long that pause lasts once the
  limit is reached. Default: 1 hour.

Reaching the cooldown never changes a driver's government eligibility
and never affects a delivery they have already claimed — it only
pauses new offers until the cooldown ends.

**Operational consequences of changing these:** lowering the maximum
declines or lengthening the cooldown will pause drivers from new work
more readily, which can slow down delivery of low-priority requests if
too few drivers remain available. Raising the maximum declines or
shortening the cooldown makes it easier for drivers to skip requests
they don't want, which can undermine fair, equal access to water if set
too loosely. Change these deliberately, not casually.

## Security

- Do not share admin accounts. Each administrator should have their
  own account so actions can be attributed to the correct person.
- Do not share API keys, service account credentials, or any value
  from the Vercel/Firebase/Resend/Meta dashboards outside of the
  people who need them to operate the system (see
  [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- Do not edit Firestore data manually (through the Firebase Console)
  during normal operation. Every request, driver, and role change must
  go through the application so that business rules and audit history
  stay correct. See [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md)
  for the only situations where manual reconciliation is appropriate.

See also [`DATA_MODEL.md`](./DATA_MODEL.md) for the underlying Firestore
schema if you need technical detail.
