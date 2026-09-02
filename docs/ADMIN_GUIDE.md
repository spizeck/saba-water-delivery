# Administrator Guide

This guide is for government administrators using the Admin portal
(`/admin`). No coding knowledge is required. For technical detail
behind any of this, see [`TECHNICAL.md`](../TECHNICAL.md).

## Pilot URL and install QR codes

The application is live as a pilot at
`https://saba-water-delivery.vercel.app`. This address remains in use until the
permanent government DNS name is configured.

Open **Admin → PWA QR Codes** (`/admin/qr-codes`) to view and print two labeled
codes:

- **Driver App** opens `/driver/install` and installs an app that launches at
  `/driver`.
- **Resident App** opens `/resident/install` and installs an app that launches
  at `/resident`.

Before printing a large quantity, scan both codes with a phone and confirm they
show the live pilot hostname, not a Vercel preview deployment. When the
permanent DNS name is available, update `NEXT_PUBLIC_APP_URL`, redeploy, and
reprint the codes; QR codes printed with the old hostname will continue to use
the old address.

Android/Chromium users receive an **Install App** button when their browser
supports it. iPhone and iPad users must open the page in Safari and choose
**Share → Add to Home Screen → Add**. Installing does not register a new account
or bypass login, role, or Driver Registry requirements.

## Users

`/admin` lists all user accounts with search/filter by name, email, or
role.

Opening a user shows their profile information, current roles,
history, and (for authenticated residents) a **Link Historical Requests**
section.

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

## Linking historical requests

When an unregistered requestor later creates an account, or when an
existing account's phone/email matches older unregistered requests, an
admin can link those requests to the account from the user's detail page:

1. Open `/admin`, find the resident, and click their name.
2. In the **Possible unregistered request history** panel, review the
   requests matched by phone or email. These are only suggestions — a
   phone match may be a shared household number.
3. Select the requests that belong to this resident and enter a reason.
4. Click **Link selected request(s)**.

The original request document is kept; only its `customerId` is updated.
The historical customer snapshot (name, phone, email as recorded at
request creation) is preserved. Each linked request gets an audit event
recording the decision, the actor, and the reason.

## Merging duplicate accounts

If one person ends up with two authenticated accounts (for example,
different email addresses), use **Admin → Merge Accounts**:

1. Select the **canonical** account to keep.
2. Select the **duplicate** account whose data will be relinked.
3. Review the comparison: roles, driver registry link, and number of
   owned requests.
4. Choose a **role merge policy**:
   - **Safe union** merges only non-sensitive roles (`resident`,
     `viewer`). Admin, dispatcher, and driver roles are not transferred
     automatically.
   - **Explicit** lets you pick the exact final role list. Use this only
     when you are certain the duplicate's sensitive roles should move to
     the canonical account.
5. Enter a reason and confirm.

The system relinks the duplicate account's requests to the canonical
account, moves a driver registry link if applicable, updates the
canonical user's roles, and (if safe) deletes the duplicate Firebase
Auth account. If Auth deletion fails, the merge record will note the
error so an admin can finish cleanup.

If both accounts are linked to different Driver Registry entries, the
merge is blocked. Unlink one of the accounts from its registry entry
first (`/admin/drivers/[driverId] → Account Link`).

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

Availability (`online` / `offline`) is set by the driver themselves —
there is no admin control to directly toggle a driver online or
offline. However, two admin actions force a driver offline as an
automatic side effect, since neither leaves it meaningful for the
driver to remain online:

- **Restricting eligibility** (see above) immediately sets the driver
  offline in addition to marking them ineligible.
- **Unlinking an account** (see above) also immediately sets the
  driver offline.

If you need a driver to stop receiving new offers right away and
restricting their eligibility is not appropriate, there is currently
no lighter-weight "pause this driver" admin action — restricting
eligibility is the only way to force a driver offline from the Admin
portal.

### Fill station meters

Each driver has an independent meter code and number per fill station
(Bottom, W.W.S., Hells Gate). Edit these from the driver's detail page.
Changing one station's assignment does not affect the others.

These meter assignments are also used when drivers record water collection.
If a driver reports a "No meter assigned" error, check or update their meter
assignment for the fill station they are using. Historical collection records
store a snapshot of the meter at the time of collection, so changing an
assignment does not alter past records.

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

The admin and dispatcher driver lists display each cooldown clearly as
**"Cooldown until ..."** (if it ends later today) or **"Daily limit reached"**
(if it runs past the end of the day), alongside the usual online/offline
and eligible/ineligible tags.

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
