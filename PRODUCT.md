# Water Delivery System

This document describes the product rules and behavior of Saba Water
Delivery, developed for the Public Entity Saba. For project provenance,
volunteer basis, and intended handover, see
[`README.md`](../README.md).

## Purpose

Create a fair, centralized system for residents to request government-produced RO water and for authorized water delivery drivers to fulfill those requests.

The system replaces the current process where customers contact individual drivers directly.

The government water system, not an individual driver, owns the request.

## Core Principles

1. **Equal access to water**
   - Customers should not need a personal relationship with a driver to receive water.
   - Open requests should be equally accessible to eligible drivers.

2. **Simple for residents**
   - A standard water request is for 1 or 2 1,000-gallon loads.
   - Most requests are ASAP.
   - Repeat requests should require very little data entry.

3. **Drivers control their schedules**
   - Drivers are independent operators and decide when they are working.
   - The system should not require a dispatcher to manage driver schedules.

4. **Central source of truth**
   - All requests, assignments, deliveries and confirmations are recorded centrally.
   - Future WhatsApp interfaces must use the same underlying request system.

5. **Government oversight**
   - Government staff can view all activity, intervene when necessary and restrict driver delivery access.

6. **Measure everything useful**
   - The system should preserve timestamps and events needed for operational statistics.

---

# Pilot and Installable Web App

Saba Water Delivery is live as a production pilot at
`https://saba-water-delivery.vercel.app`. The Vercel address remains the
canonical public URL until the Public Entity Saba configures a permanent DNS
name.

The resident and driver experiences are provided by one installable Progressive
Web App (PWA), not separate native iOS or Android applications:

- Driver onboarding: `/driver/install`; installed launch destination: `/driver`.
- Resident onboarding: `/resident/install`; installed launch destination:
  `/resident`.
- Android and Chromium browsers offer the standard browser installation prompt
  when available.
- iPhone and iPad users install from Safari with **Share → Add to Home Screen →
  Add**. Other iOS browsers direct users to Safari for this standard flow.
- An installed launch uses standalone display mode and preserves the existing
  Firebase account/session behavior. Installation never creates another user
  account and does not change role authorization.
- Administrators can display and print permanent driver and resident install QR
  codes from `/admin/qr-codes`.

The PWA is intentionally not an offline transaction system. It clearly reports
network loss and provides a static offline fallback, while authenticated portal
pages, Firestore data, API responses, and writes remain network-driven.

---

# User Roles

A single user may hold **multiple roles simultaneously**. For example, a user
may be both a resident and a driver, or a resident, driver, and admin. Users do
not need separate accounts for different functions.

New users default to `roles: ["resident"]`. Additional roles are granted only
through trusted server-side operations (Admin SDK / Firestore console).

When a user has multiple roles, a portal switcher in the application header
allows them to navigate between their authorized portals. The switcher is a
navigation preference only — it does not modify the user's stored roles.

## Resident

Residents can:

- Create an account and log in.
- Maintain their contact and delivery information.
- Request 1 or 2 1,000-gallon loads of water.
- Request delivery ASAP.
- Optionally select a preferred driver.
- View current request status.
- View previous requests and deliveries.
- Confirm that a delivery was received.
- Report that a delivery marked delivered was not received.
- Upload property photos to help drivers locate the delivery point (planned).

Authentication should initially support:

- Google
- Facebook (shown as "Coming Soon" while Meta business verification is
  pending; the Firebase provider integration is preserved)
- Email/password

## Driver Registry

Drivers are a government-managed roster, not a byproduct of account
creation. A person becomes an operational driver only when government
staff explicitly enters them in the **Driver Registry** — never merely
by a user account receiving the `driver` role.

A registry entry can exist entirely on its own, before that person ever
creates or signs into an application account. The current roster
(entered by staff, not self-registered) is:

- Government
- Shanon Levenston
- Earl Ballentyne
- Michael Hodge
- Andy Lavia
- Eagen Aquasab

These are the same six people at every fill station — one registry
entry each, not one per station.

### Account linking

Once a driver signs into the application for the first time (creating a
normal user account), an admin explicitly links that account to their
existing registry entry from **Drivers → Driver Detail → Link Account**,
searching by name, phone, or email. Linking:

- Adds the `driver` role to that account (preserving `resident` and any
  other existing roles).
- Does **not** automatically grant eligibility — that remains a separate
  government decision.
- Cannot accidentally link one account to more than one driver.

An admin can also **unlink** an account later. Unlinking:

- Removes the `driver` role from the linked account (preserving
  `resident` and any other roles).
- Forces the driver offline.
- Is blocked while the driver has active claimed deliveries (those must
  be resolved or reassigned first).
- Always preserves the registry record, driver history, and delivery
  history.

### Separate concepts

- **Registry** — recognized by government as a driver.
- **Account link** — has a linked application account.
- **Eligibility** — `eligible` / `ineligible` (government-controlled).
- **Availability** — `online` / `offline` (driver-controlled).
- **Cooldown** — temporary dispatch pause from the decline-limit policy.

A driver can receive a new delivery offer only when all of: registry
entry exists, account is linked, the account has the `driver` role, they
are eligible, they are online, and they are not in cooldown.

## Fill Stations and Meters

The current fill stations are:

- Bottom Fill Station (`bottom`)
- W.W.S. Fill Station (`wws`)
- Hells Gate Fill Station (`hells-gate`)

Each driver has an independent meter assignment (a short code and a
meter number) at each fill station — changing one station's assignment
does not affect the others, even though today the same driver happens to
use the same meter number everywhere:

| Driver | Bottom | W.W.S. | Hells Gate |
| --- | --- | --- | --- |
| Government | BTM1 / Meter 1 | WWS1 / Meter 1 | HG1 / Meter 1 |
| Shanon Levenston | BTM2 / Meter 2 | WWS2 / Meter 2 | HG2 / Meter 2 |
| Earl Ballentyne | BTM3 / Meter 3 | WWS3 / Meter 3 | HG3 / Meter 3 |
| Michael Hodge | BTM4 / Meter 4 | WWS4 / Meter 4 | HG4 / Meter 4 |
| Andy Lavia | BTM5 / Meter 5 | WWS5 / Meter 5 | HG5 / Meter 5 |
| Eagen Aquasab | BTM6 / Meter 6 | WWS6 / Meter 6 | HG6 / Meter 6 |

Only the operationally useful meter code and number are stored — not
full meter serial numbers. Admins can edit assignments per station, and
every change is audited.

---

## Driver

Drivers can:

- Log in.
- Set themselves online or offline.
- Receive one delivery offer at a time and accept or decline it.
- Claim (by accepting) an offered delivery.
- View their claimed deliveries.
- Access customer delivery information.
- Mark a delivery as delivered.
- Upload proof-of-delivery photos (planned).
- View their delivery history.

Government staff may restrict a driver's delivery access.

An ineligible driver cannot claim new deliveries regardless of their online/offline preference.

Drivers do **not** browse a list of open requests. To reduce cherry-picking
and support equal access to water, the driver portal shows at most one
claimable offer at a time — see "Dispatch Offers" below.

**Important:** Having the `driver` role does NOT make someone eligible to deliver
water. Role membership (`roles` includes `"driver"`) grants access to driver
functionality. Eligibility (`driverRegistry/{driverId}.eligibilityStatus ==
"eligible"`) determines whether a driver may actually claim deliveries. These
are separate concepts.

## Dispatcher

Dispatchers can:

- View all water requests.
- Create a request for a customer who calls or visits the office — for
  either an existing registered resident or an unregistered/manual
  customer. See "Dispatcher-Created Requests" below.
- View request status and history.
- Assign or reassign requests when necessary.
- Handle delivery problems and disputes.
- Operationally confirm a delivery on behalf of an unregistered customer
  who has no application account to confirm through themselves.
- View operational statistics.

## Administrator

Administrators have dispatcher capabilities plus system-management capabilities:

- Viewing all users with their roles and driver status.
- Adding/removing manually assignable roles (`viewer`, `dispatcher`, `admin`).
- Managing driver linking/unlinking and eligibility in the Driver Registry.
- Managing application settings, including the driver decline limit and
  cooldown hours used by the dispatch offer workflow.

Role management safeguards:

- `resident` is the baseline role and cannot be removed.
- `driver` is a **system-managed role** and cannot be added or removed
  from the Admin User Management screen. Linking a Driver Registry entry
  to a user automatically grants the `driver` role; unlinking it
  automatically removes the `driver` role.
- Admins cannot remove their own admin role (self-lockout protection).
- The last system admin cannot be removed (system lockout protection).
- Unlinking a Driver Registry account is blocked while the driver has
  active claimed deliveries.
- Role changes are audited with actor and timestamp.

Both dispatchers and administrators can view operational statistics including
demand trends, delivery metrics, driver activity, preferred-driver usage,
and dispute rates.

Dispatcher and administrator should be separate roles even if their permissions overlap initially.

## Viewer

`viewer` is a read-only oversight role for government personnel who need
visibility into operations without operational control — for example, a
supervisor who wants to monitor demand and delivery activity without
being able to change anything.

Users remain multi-role, e.g. `["resident", "viewer"]` or
`["resident", "viewer", "admin"]`. New public users still default to
`["resident"]` only; `viewer` is granted the same way as any other
non-baseline role, from Admin User Management.

Viewer may see:

- Current water requests and their statuses
- Aging/outstanding demand
- Driver operational status (eligibility/availability, not contact info)
- Operational statistics

Viewer must NOT be able to create, assign, reassign, or cancel requests;
resolve disputes; confirm deliveries; change driver eligibility;
create/edit drivers or link/unlink accounts; modify meter assignments;
modify users or roles; or modify dispatch settings. These restrictions
are enforced server-side, not by hiding buttons.

### Viewer privacy

Read-only does not mean unrestricted access to resident information.
Viewer does **not** get access to the Admin user directory, and the
Viewer interface deliberately omits fields not needed for oversight —
phone, email, and full delivery directions are not shown there, even
though dispatcher/admin (who actively manage deliveries) do see them.
See TECHNICAL.md "Viewer Role" for the enforcement details.

---

# Standard Water Request

Every request is for either:

- **1 load** = **1,000 gallons**, or
- **2 loads** = **2,000 gallons**

A two-load request is still **one request** — one priority, one
assignment, one confirmation/dispute record. Arbitrary quantities (0,
3, 4, etc.) are not allowed in V1.

A resident normally requests delivery:

**ASAP**

Scheduled delivery dates and time slots are outside the initial scope.

---

# Water Situation & Request Priority

Government operational feedback ahead of production launch asked for two
related things: more information about the resident's actual water
situation, and a simple, explainable way to let genuine emergencies move
ahead of the queue without breaking fairness for everyone else. See
TECHNICAL.md "Priority-Based Dispatch" for the implementation details
this section describes.

## Water situation information

Every request — resident-submitted or dispatcher-created — captures:

- **Number of people relying on this water supply** (optional positive
  integer).
- **Vulnerable persons or critical circumstances**: Elderly person /
  Infant or young child / Medical need / Essential services
  (Commercial/business) / Hotel or Restaurant / None. This is
  deliberately NOT a medical intake form — enough information to assess
  urgency, never a detailed health record. The generic "Other critical
  circumstance" option has been removed.
  - **Note (flagged, not resolved):** "Essential services
    (Commercial/business)" and "Hotel or Restaurant" overlap
    materially — a hotel or restaurant is itself a commercial business.
    Government testing asked specifically for a distinct "Hotel or
    Restaurant" option without removing or renaming "Essential services
    (Commercial/business)", so both remain as separate canonical
    options. This is a deliberate government decision, not an oversight
    — a future consolidation of these two options should be a
    deliberate government/product decision, not something inferred by
    engineering.
- **Available cistern/storage capacity**, as free-form text the resident
  or caller can describe in their own words (e.g. "1500", "About 2,000
  gallons", "Unknown"). It is not parsed into a number and does not
  affect priority.
- **Resident-reported urgency**: Normal / Critical only (see "Resident-
  Reported Urgency" below — "Urgent" was removed from this choice after
  government testing).

The earlier "How much water remains?" question has been removed.
Urgency is now the primary water-situation indicator, together with
vulnerable/critical circumstances.

## Resident-Reported Urgency

Government testing ahead of the next round found that the original
three-way Normal / Urgent / Critical choice, together with the
days/feet/water-remaining explanatory text shown under each option,
caused subjective debate rather than a clear signal. The resident-facing
form was simplified in response:

- The resident now chooses only **Normal** or **Critical** —
  "Urgent" is no longer a resident-facing choice.
- **Normal** is shown with no supply-estimate explanation text (it is
  simply "Normal").
- **Critical** requires the resident (or the dispatcher recording a
  caller's report) to fill in a required explanation — "Please explain
  why this request is critical." — before the request can be submitted.
  A blank or whitespace-only explanation is rejected, both in the form
  and server-side (`CRITICAL_EXPLANATION_REQUIRED`).
- Switching back to Normal before submitting discards any explanation
  text already typed — it is never silently retained or submitted.

This resident-reported urgency (`reportedUrgency: "normal" |
"critical"`) is a distinct concept from the operational
`dispatchPriority` below, which still supports `normal` / `urgent` /
`critical` — see "Dispatch priority is not the same as reported
urgency". Government staff can still assign or escalate any request to
Urgent through the existing dispatcher override; residents simply no
longer choose it themselves.

This information is a **snapshot** — it describes the circumstances at
the moment the request was made and is never overwritten by later
profile edits or re-derived later (see TECHNICAL.md "Historical
Snapshot").

## Required attestation

Before a request can be submitted, the resident (or the dispatcher
entering the request on a caller's behalf) must check an attestation
confirming they are authorized to request water at the location and that
the statements are true and factual. The system records:

- `attestationAccepted: true`
- `attestationAcceptedAt: Timestamp`

The request is rejected server-side if the attestation is not checked.
For dispatcher-created requests, the wording reflects that staff are
accurately recording the information provided by the caller — not that
the dispatcher is personally making a citizen attestation.

The primary action on the request form is now "Review request", and a
final "Create Request" action appears only on the confirmation screen
after the attestation is checked.

## Dispatch priority is not the same as reported urgency

The system tracks two separate things, and they must never be conflated:

- `reportedUrgency` (`normal` / `critical`) — the resident's own
  characterization, captured on the request form. See "Resident-
  Reported Urgency" above.
- `dispatchPriority` (`normal` / `urgent` / `critical`) — the actual
  operational priority used for dispatch ordering, together with who
  set it (`prioritySource`: `system` or `dispatcher`), why
  (`priorityReason`), and — for staff overrides — who and when.

Selecting "Critical" is no longer a casual radio-button choice — it
requires a required written explanation (see "Critical Explanation"
above) before the request can even be submitted. Because of that
stronger signal, a validated Critical self-report now reaches Critical
`dispatchPriority` directly (previously it was capped at Urgent pending
staff review; that cap is no longer necessary now that Critical always
carries a specific, staff-reviewable reason). `dispatchPriority` never
reaches Urgent through the resident's own report — Urgent is only
ever set by dispatcher/admin override (see below), which residents
cannot trigger themselves.

The initial `dispatchPriority` is set by a short, documented,
deterministic rule (see TECHNICAL.md "Initial Priority Rules") based on
the structured water-situation answers, not an opaque score. Government
staff can always see the full water situation (including the Critical
explanation) and override the priority — to Urgent, to Critical, or
back to Normal — with a required reason; every override is audited
(`request_priority_changed`).

## Priority-based dispatch

Requests are offered to drivers **highest priority first, oldest
request first within that priority** — critical, then urgent, then
normal, and within each level, fairness by request age exactly as
before. A resident's request never loses its place in the queue due to
a decline, hold expiration, or dispatcher reassignment — its original
request time is always preserved (see "Request Age Still Matters" in
TECHNICAL.md).

Drivers still receive only ONE offer at a time — priority changes which
request that is, never how many they see.

## Statistics and privacy

Statistics report priority-level counts, outstanding critical/urgent
requests, and average delivery time by priority (see "Statistics"
below). Vulnerable-circumstance details are never included in
statistics or shown to drivers — see "Privacy" below.

---

# Dispatcher-Created Requests

Not every resident submits their own request online. Government staff
can create a water request on behalf of a customer who calls or visits
the office — a phone/walk-in request is a **first-class request in the
central system**, not an alternate or secondary workflow.

A dispatcher-created request enters the exact same delivery workflow as
a resident-created one:

- The same preferred-driver hold behavior.
- The same oldest-request-first fairness.
- The same one-offer-at-a-time driver dispatch, accept/decline, and
  decline/cooldown rules.
- The same atomic claiming guarantee.
- The same delivery, dispute, reassignment, cancellation, and statistics
  handling.

There is no separate "manual queue" — drivers never know or need to know
whether a request came from the web or from a phone call, except where
there is a genuine operational reason (see "Unregistered Customers"
below).

## Existing (registered) resident

A dispatcher can search for a resident by name, phone, or email,
select them to set the **Requestor**, and then record a separate **Delivery
location** for the request. The selected resident's saved area is shown
for reference, but if it is a legacy/noncanonical value it is marked
"Needs update" and is **not** silently used as the request village. The
dispatcher may adjust the request's delivery directions (and village)
**for this request only** — this never overwrites the resident's saved
profile.

The existing one-active-request-per-resident rule is preserved exactly:
if the resident already has an unresolved request, the dispatcher sees
this clearly before submitting and cannot create a duplicate. Resolving
that conflict uses the same dispatcher tools already available for any
request (reassign, cancel, resolve a dispute, etc.).

## Unregistered requestors

A resident must **not** be required to create an application account
just to receive government water. A dispatcher can create a request for
someone with no account by entering:

- Requestor name (required)
- Phone number (required)
- Village/area (required)
- Delivery directions (required)
- Email (optional)

No Firebase account is created for this requestor, and none is required.

Because an unregistered requestor has no stable account identity, exact
duplicate detection is not possible the way it is for a registered
resident. Instead, the dispatcher is warned when an unresolved request
already exists with a matching phone number, and shown that existing
request. Phone matching is **not** treated as proof of identity — a
dispatcher may deliberately proceed anyway (e.g. a shared household
phone), and doing so is recorded, never silent.

If the dispatcher enters an email address, the system checks whether an
existing resident account already uses that email. If one exists, the
dispatcher can choose to create the request as a registered request for
that account. If no account exists and the dispatcher opts in, the
system can send the requestor a branded account-setup email with a secure
password-reset link — but the request itself is still created normally if
the invitation is not sent or fails. The dispatcher never knows or sets
anyone's password.

## Account linking and merging

An unregistered requestor's past requests can later be associated with a
registered account through a deliberate, staff-initiated, auditable
action. An admin opens the resident's user detail page and uses **Link
Historical Requests**; the system surfaces unregistered requests whose
stored phone or email matches the account. Staff select the requests that
belong to that resident and link them. The historical customer snapshot on
each request is preserved; only `customerId` is updated.

If one real person ends up with two authenticated accounts — for example,
one created with Facebook and another with Google — an admin can use
**Merge Accounts** (`Admin → Merge Accounts`). The admin must explicitly
choose which account remains canonical, review request counts, roles,
and driver registry links, and provide a reason. The merge relinks
request ownership and can move a driver registry link, but it never
silently transfers admin, dispatcher, or driver roles unless the admin
explicitly opts into those roles. A detailed audit record is kept.

Automatic linking based on name alone is never performed.

---

# Preferred Driver

A resident may optionally choose a preferred driver.

If a preferred driver is selected:

1. The request enters a preferred-driver hold.
2. The preferred driver has exclusive access to claim it during a configurable period.
3. If the driver claims it, the normal delivery workflow begins.
4. If the driver declines or the preference window expires, the request automatically enters the general driver queue.
5. Once in the general queue, all eligible online drivers have equal access to claim it.

The preference window must be configurable rather than hard-coded.

Initial value:

**24 hours**

This value should be easy for administrators to change later.

A resident choosing a preferred driver must not cause their water request to become permanently dependent on that driver.

If the preferred driver actively declines their offer, the hold ends
immediately (rather than waiting for the window to expire) and the
request opens to the general queue at its original request time. See
"Dispatch Offers" below.

## A preference, never a guarantee

A preferred driver is explicitly a **resident preference**, not an
assignment. It must never prevent government from fulfilling a genuine
water emergency. Concretely:

- **Normal-priority request**: the preferred-driver window applies
  exactly as above, even if that driver is currently offline — they may
  still come online and claim it before the window expires. Clearly
  store the expiration; release to the general queue when it passes.
- **Urgent/Critical request**: the preference does not get to create an
  unreasonable delay. If the preferred driver is immediately eligible,
  linked, online, not in cooldown, and has no active claimed delivery,
  they still get first offer. If they are offline, ineligible, unlinked,
  in cooldown, or already servicing another delivery, the hold is skipped
  entirely and the request goes straight to the general queue — it is never
  trapped waiting for that specific driver.
- **Preferred driver declines**: the preference ends immediately and
  the request opens to the general queue, regardless of priority.
- **Priority escalated while held** (e.g. dispatcher changes Normal to
  Critical while the resident's preferred driver is offline): the hold
  is re-evaluated immediately using the same rule as above, rather than
  being left to expire on its original schedule.

---

# Driver Availability

Driver operational status and government authorization are separate concepts.

A driver can set:

- `online`
- `offline`

Government controls whether the driver is:

- `eligible`
- `ineligible`

An eligible, online driver can claim eligible requests, but only if they do
not already have an active claimed delivery. "Online" is the driver's chosen
availability; "immediately available for another delivery" adds the additional
requirement that they currently have no claimed request. Accepting a delivery
keeps the driver online but makes them temporarily unavailable for new
assignments until the current delivery is marked delivered.

An eligible, offline driver receives no new work.

An ineligible driver cannot claim new work.

Access may be restricted for reasons including outstanding water payment, administrative requirements, or other corrective actions.

V1 does not calculate driver balances or integrate accounting.

Restricting and restoring delivery access should be manually controlled by authorized government staff and recorded in the audit history.

---

# Dispatch Offers (One Request at a Time)

Rather than browsing a list of open requests, an eligible, online driver is
offered exactly **one** claimable request at a time — similar to
delivery-driver platforms. This reduces cherry-picking and supports equal
access to water.

A driver may have at most **one active claimed delivery** at any time. If a
driver already has a request in `claimed` status, the system must not issue
another offer and must not allow them to claim another request. They remain
online and eligible; they simply cannot take on a second delivery until the
current one is marked delivered. This rule is enforced server-side, not only
by the UI.

The driver sees:

- Customer name
- Village
- Quantity (e.g., "1 load (1,000 gallons)" or "2 loads (2,000 gallons)")
- Request age
- Delivery directions
- Request Notes / Comments when provided

The driver may:

- **Accept** — claims the delivery. Claiming remains atomic: it is
  impossible for two drivers to successfully claim the same request, even
  if both were offered it (see "Request Claiming" in TECHNICAL.md).
- **Decline** — the request is not claimed and remains available, at its
  original request time, for another eligible driver. Declining does not
  move the customer to the back of the queue.

## Selection order

For normal open requests, the oldest eligible request is offered first
(fairness by age). A preferred-driver hold is only ever offered to the
preferred driver during the hold window; other drivers do not see it. If
that driver declines, the hold ends immediately and the request opens to
the general queue.

A driver is not immediately re-offered a request they just declined.

## Decline limit and cooldown

To discourage indiscriminate declining, a driver may decline only a
limited number of offers per local day before new offers are paused for
them for a cooldown period. Both values are configurable by an
administrator (see "Administrator" above):

- Maximum declines per day — default **3**
- Decline cooldown — default **1 hour**

Reaching the cooldown does **not** change the driver's government
eligibility and does not affect their existing claimed deliveries — it
only pauses new offers until the cooldown expires. A driver cannot bypass
the cooldown by toggling online/offline; it is enforced using server time.

The app now distinguishes three decline outcomes:

- **Still eligible**: "Load declined. Another offer will appear when available."
- **Temporary cooldown**: "You have reached the decline limit. You are offline
  until 3:42 PM." (uses the actual configured cooldown hours and Saba-local time).
- **Daily limit reached**: "You have reached today's decline limit and are offline
  for the rest of the day. You can receive offers again on the Saba-local date
  shown." (when the computed cooldown would extend past the end of the current
  Saba day; the exact date and time come from the configured cooldown hours).

The driver portal reflects the enforced state clearly ("Offline until ...",
"Offline for the rest of today", or "Daily limit reached"), and the online
switch is disabled while a cooldown is active. Dispatcher and admin driver
lists show the same reason so staff do not have to guess why a driver is not
receiving offers.

---

# Batch Dispatch (UI: "Delivery Runs")

> **UI terminology:** dispatchers and drivers see "Delivery Runs" in the
> interface. The internal/backend name remains "Batch Dispatch" and
> Firestore field names (`dispatchBatchId`, `dispatchBatches` collection)
> are unchanged.

The normal driver workflow above — one offer at a time, one active
self-claimed delivery — remains unchanged and is the default for every
driver, every day. **Batch Dispatch is a separate, explicit
dispatcher-controlled exception** for situations where government
staff need to preassign several loads to one driver at once, most
importantly for a driver whose phone or data connection is unreliable
and who cannot be expected to receive and respond to individual offers
throughout the day.

Do not blur the two modes:

```text
Normal driver dispatch          Dispatcher batch dispatch
one offer at a time             staff deliberately assigns a
one active self-claimed         defined group of loads
delivery                        printable driver run sheet
```

Batch Dispatch never weakens the normal one-offer-at-a-time fairness
model for any driver's ordinary self-claimed work — see TECHNICAL.md
"Batch Dispatch" for how this is enforced.

## Who can use it

Only `dispatcher` and `admin` staff can create a batch, assign loads
into it, or generate/reprint its run sheet. Drivers cannot create their
own batches. Residents never see batch information. Viewers may see
that a load is batch-assigned (consistent with their existing
oversight-only access to requests and drivers) but cannot change
anything.

## Creating a batch

1. A dispatcher opens **Batch Dispatch** and selects a driver.
2. The driver must already exist in the Driver Registry, be linked to
   an account, and be marked eligible — the same baseline required for
   any assignment. The driver does **not** need to be online, and being
   in a decline cooldown does not block a batch assignment either —
   this is a deliberate staff decision, not a normal offer, and the
   whole point may be preparing a printed run sheet for a driver who
   cannot reliably use the app. Their online/offline and cooldown
   status is shown to the dispatcher so the decision is informed, never
   hidden.
3. The dispatcher sees every outstanding request still waiting for a
   driver (not yet claimed by anyone), by default in the same
   fairness order used everywhere else — highest priority first,
   oldest first within a priority level. The dispatcher may select any
   subset, in any order, for genuine operational reasons.
4. If a selected request is currently held for a **different**
   resident's preferred driver, this is shown clearly and the
   dispatcher must explicitly acknowledge overriding that preference
   before continuing — it is never silently overridden. A hold
   addressed to the same driver the batch is being assigned to is not
   an override.
5. The dispatcher reviews the full list (driver, loads, total
   gallons, any acknowledged overrides) before confirming.
6. On confirmation, every selected load is assigned to that driver at
   once, and a printable run sheet is generated.

Assignment is all-or-nothing: if any selected request changed state
while the dispatcher was reviewing (for example, claimed by someone
else in the meantime), nothing in the batch is assigned and the
dispatcher must review and try again — see TECHNICAL.md "Batch
Dispatch" "Atomic Assignment."

There is no fixed business-policy limit on how many loads a batch may
contain; a generous technical maximum exists only to keep a single
batch-creation operation comfortably small (see TECHNICAL.md).

## The driver dispatch sheet

A compact, printable PDF titled "Driver Dispatch Sheet" lists every
request in the batch, in order, with the customer's name, phone,
village, quantity (loads and gallons), delivery directions, priority,
requested time and age, and a preferred-driver note when relevant. It
includes a simple completion area for each request not yet delivered
(a checkbox, space for driver initials, time, and notes) so a driver
without app access can still be tracked on paper. It never includes the
resident's vulnerable-circumstance details, persons-affected count,
critical explanation, or any internal system identifiers — the same
privacy posture as the operational continuity snapshot (see "Water
Situation Privacy" above).

A dispatcher can reopen an active or completed batch at any time and
**reprint** its dispatch sheet. Reprinting never creates a new batch —
it reflects the batch's current member requests and their current status
(for example, a request already delivered shows as delivered instead of
a blank completion area), always with a clear generation timestamp.

## Completing batch loads

Each request in a batch is still completed individually, exactly like any
other delivery — its own delivered time, its own resident confirmation
window, its own dispute handling, its own audit trail and statistics
attribution. A two-load request appears as one batch entry and is
completed as one delivery when the full 2,000 gallons have been
physically delivered. There is no single button that marks an entire
batch delivered at once.

If the driver has app access, they see each batch-assigned load in
their normal "My deliveries" list, marked as a batch assignment, and
mark it delivered exactly as they would any claimed delivery. If the
driver genuinely cannot use the app, a dispatcher can record that a
specific load was delivered on the driver's behalf, after verifying
with the driver — see TECHNICAL.md "Batch Dispatch" "Staff delivery
reconciliation." This is deliberately scoped to batch-assigned loads
only; it is not a general way for staff to mark any delivery delivered
on a driver's behalf.

## Reassignment and cancellation

If one request in a batch needs to be reassigned to a different driver,
or cancelled, that is handled exactly like any other request
reassignment or cancellation — it simply leaves that batch's current
membership. The rest of the batch is unaffected and remains intact.

## Statistics and the continuity report

A batch-assigned delivery counts exactly like any other delivery for
gallons, village demand, priority, delivery timing, driver
attribution, and disputes — Batch Dispatch does not create a separate
category of statistics. An outstanding batch-assigned load still
appears in the nightly/manual continuity report's Assigned Loads
section like any other assigned load, marked "(Batch)" for context —
it can never be missed during an outage merely because it was assigned
through Batch Dispatch instead of a normal claim.

# Delivery Workflow

Normal lifecycle:

`REQUESTED`

→ `PREFERRED_DRIVER_HOLD` when applicable

→ `AVAILABLE`

→ `CLAIMED`

→ `DELIVERED`

→ `CONFIRMED`

Exception states may include:

- `CANCELLED`
- `DISPUTED`

The exact implementation may use additional internal states if needed, but the resident-facing statuses should remain simple.

# Water Collection Tracking

Each physical load is **1,000 gallons**. Before marking a request delivered,
the driver records the fill station used for every requested load; **Bottom** is
the default and primary fill station. At collection time, the system snapshots
the driver's assigned meter for that station. A request cannot be marked
`DELIVERED` until every requested load has a collection record.

Collection history preserves the station and meter snapshot even if assignments
later change. Authorized dispatcher/staff may reconcile a missing collection
record with a required verification note. Statistics use these snapshots to
track fill-station and meter usage.

---

# Request Notes / Comments

Each water request may include optional `requestNotes` for additional
request-specific information or questions that do not fit structured fields.
Notes are trimmed, limited to 1,000 characters, and stored only on the request;
they never update the resident's saved profile. They do not replace village,
delivery directions, quantity, priority, vulnerable circumstances, or a
critical explanation.

Residents and dispatchers see Notes / Comments during request review.
Dispatchers can edit them through the existing Edit Request workflow, with the
change included in the `request_edited` audit metadata. Notes appear
subordinately in resident/request detail and driver offer/assigned-delivery
views. Because they may contain access or timing information needed to complete
a delivery, compact notes also appear in the continuity report and delivery-run
sheet; print output truncates notes beyond 240 characters to preserve layout.

---

# Delivery Confirmation

After delivering water, the driver marks the request as delivered. At
that moment the driver's assignment is complete: the driver stays
online and eligible, receives no cooldown from this, and can
immediately be offered another request — see "Dispatch Offers (One
Request at a Time)" above. **Customer confirmation never affects driver
availability.**

The customer then has a configurable window — **24 hours** by default
— to confirm receipt or report a problem. Residents should not be expected to
repeatedly return to the portal merely to discover that a delivery is awaiting
confirmation. When a registered resident with a claimed account and email has a
request marked delivered, the system sends a **Please confirm your water
delivery** email with a **Review Delivery** link. The authenticated link returns
the resident directly to the active confirmation controls after login when
necessary.

The notification is also sent when authorized staff record delivery on a
driver's behalf. A deterministic audit record and Resend idempotency key prevent
the same delivery transition from generating duplicate messages. Notification
failure is recorded but never reverses delivery, retains the driver's active
assignment, or changes the confirmation deadline.

Customer options:

- **Yes, received**
- **No, there is a problem**

If confirmed:

`DELIVERED → CONFIRMED`

If rejected:

`DELIVERED → DISPUTED`

If the customer does not respond within the confirmation window, the
request is **automatically confirmed**:

`DELIVERED → CONFIRMED` (system timeout, not a customer action)

There is no separate "delivered but unconfirmed" status — a request is
either still `DELIVERED` (within its confirmation window, or
occasionally just past it and not yet touched by any operational
workflow), or it has become `CONFIRMED`, whether the resident responded
or the window simply expired. The audit trail always distinguishes an
automatic confirmation from an actual customer confirmation — see
"Auditability" below.

The system must preserve the driver's delivery timestamp and the
confirmation timestamp separately, and must record whether a
confirmation was a genuine customer response, a staff action on behalf
of an unregistered customer, or an automatic timeout.

## Unregistered customers

An unregistered customer has no authenticated resident portal to confirm
or dispute through. An email address on an unregistered request is contact
information, not proof of an authenticated account, so the system does not send
that person an authenticated confirmation link. Their delivery is never automatically marked
confirmed merely because they lack an account. Instead, once the driver
marks it delivered, authorized dispatcher/admin staff may operationally
confirm the delivery on the customer's behalf. This is recorded with a
distinct audit event (staff confirmation, not a customer action) and
requires the confirming staff member to be identified — see TECHNICAL.md
"Dispatcher-Created Requests". This is a V1 stand-in; it remains
compatible with a future WhatsApp flow where the customer could
eventually confirm directly.

---

# Customer Delivery Location

The data model should support:

- Village/area
- Delivery directions
- Optional structured address information
- Optional geographic/map coordinates in the future

Do not make conventional street addresses mandatory if they do not match local addressing practices.

Residents should be able to save their normal delivery location for future requests.

---

# Delivery Profile Confirmation Reminder

Failed deliveries are frequently caused by an outdated phone number,
village, or delivery directions rather than an operational problem. The
Resident portal periodically reminds a resident to confirm this
information is still correct — this is a data-quality safeguard, not a
login gimmick, so it deliberately does **not** appear on every visit.

## Required delivery-profile fields

For this reminder, "required" means:

- Phone number
- Village (must be one of the five canonical village choices)
- Delivery directions

These are the same canonical profile fields used everywhere else in the
system — no duplicate fields were introduced. An old or invalid village
value such as `Lower Hells Gate`, `The Level`, or `Sunshine Ridge` is
treated the same as a missing village: the resident must update it before
they can confirm their information or request water.

## The modal

Heading: **Please confirm your delivery information**

The modal shows the resident's current phone, village, and delivery
directions so confirming is meaningful — the resident can see exactly
what they are being asked to confirm, not asked to affirm information
they cannot see.

Two possible states:

- **Information complete** — the resident sees **Review My Information**
  (goes to the existing profile editing section — there is no second,
  duplicate profile editor built for this modal) and **Everything Is
  Correct** (records that they reviewed and confirmed it).
- **Information incomplete or invalid** — the modal is more forceful: it
  clearly identifies what is missing or needs to be updated, offers only
  **Review My Information**, and does **not** offer "Everything Is
  Correct." A resident cannot confirm a blank phone number, a missing
  delivery direction, or a noncanonical village. Casual dismissal (closing
  via an X or the backdrop) is not offered in this state.

For the normal periodic reminder (information already complete), the
resident may dismiss the modal without acting on it (e.g. via a close
control), but doing so does **not** count as a confirmation — the
reminder simply reappears on the next Resident portal visit until the
resident actually confirms or reviews their information.

## When it appears

The reminder is **not** based on login frequency, account age, or
number of visits. It appears when:

1. Required delivery information is missing or invalid (for example, an
   old noncanonical village value), **or**
2. The resident has not meaningfully reviewed their delivery
   information in the last **45 days** — where "meaningfully reviewed"
   means the later of:
   - The resident explicitly confirming via "Everything Is Correct," or
   - Saving an actual change to phone/village/delivery directions
     (which is itself an active review — the resident should not have
     to separately return to the modal right after editing), or
   - Having a delivery reach `confirmed` status (a completed delivery is
     strong evidence the information on file was current and usable).

If a resident has never confirmed their information and has never had a
completed delivery, the reminder appears on their first Resident portal
visit.

A completed delivery effectively restarts the 45-day period even if the
resident never explicitly clicks "Everything Is Correct" — e.g. a
resident who confirmed their profile, then received and confirmed a
delivery 30 days later, will not see the reminder again until 45 days
after that delivery.

## Not a hard blocker

Once required information is complete, the 45-day reminder is a UX
nudge, not a blocker — the resident may dismiss it and continue using
the portal. Missing required information is different: profile
completion remains required before requesting water, exactly as
before this feature (see "Standard Water Request" / existing profile
requirements) — this reminder does not change that enforcement, only
brings it to the resident's attention with specific, actionable detail.

## Scope

This reminder is specific to the Resident portal (`/resident`). A
multi-role user (e.g. resident + driver) does not see it while using
another portal — it is evaluated only when they are actually on the
Resident portal.

Property/cistern photo review is explicitly **not** part of this
reminder yet (see PRODUCT.md "Property Photos" — planned, not built).
The modal is deliberately structured so a future photo-review step
could be added later without a redesign, but no placeholder photo UI
exists today.

---

# Water Situation Privacy

Some of the new water-situation information is sensitive, especially
vulnerable-person circumstances, the required Critical explanation, and
anything medical-related. Apply least privilege:

- **Drivers** may need to know a delivery is Urgent/Critical to
  understand why it was offered ahead of others, but do NOT need — and
  are never shown — the underlying vulnerable-circumstance details,
  persons-affected count, available-storage figures, or the resident's
  Critical explanation.
- **Dispatcher/admin** staff see the full water situation, including the
  Critical explanation, because they need it to assess and, if
  necessary, override priority.
- **Viewer** (read-only oversight) sees the dispatch priority level
  (operational, not sensitive) but not the underlying water-situation
  detail, consistent with the existing Viewer privacy posture (see
  "Viewer Privacy" above).
- **Statistics** never break priority data down by individual resident,
  village, or driver — aggregate counts and timings only.
- **Operational continuity snapshot** (see "Operational Continuity
  Snapshot" below) includes only what staff need to manually complete
  deliveries during an outage — never the vulnerable-circumstance
  details or Critical explanation.

---

# Property Photos

Residents should be able to upload photos of their property to help drivers locate the delivery point.

Supported photo types:

- **House/exterior** — helps drivers identify the property.
- **Cistern/fill-point** — shows where to connect for delivery.
- **Access/location** — documents gate access, road conditions, or other navigation details.
- **Other** — additional context as needed.

Residents should be able to update or remove their own photos at any time.

Property photos are private. Drivers should only see a resident's photos when they have a legitimate operational need — specifically, when they hold a claimed or assigned delivery for that resident.

Drivers must not be able to browse unrelated customer property photos.

Dispatchers and administrators may view property photos for operational support.

Photo data must not be stored as publicly accessible assets. See the Privacy section for additional requirements.

---

# Proof of Delivery

After completing a delivery, the assigned driver should be able to upload a delivery confirmation photo documenting the completed delivery.

This is similar to proof-of-delivery workflows used by package delivery services.

Each photo should be tied to:

- The water request
- The assigned driver
- An upload timestamp

The system should support multiple photos per request. Potential photo types include:

- **Proof of delivery** — confirms water was delivered.
- **Delivery issue** — documents a problem encountered during delivery.
- **Access issue** — documents difficulty accessing the delivery point.
- **Other** — additional context.

Only the driver assigned to a request may upload photos for that request.

The resident who owns the request, the assigned driver, and dispatchers/administrators may view request photos.

---

# Photo Privacy

Property photos may reveal details of private residences. The system must treat them accordingly:

- **Least-privilege access** — only users with a legitimate operational need may view photos.
- **No public URLs** — photos must not be served through permanent unrestricted download links.
- **No personal data in filenames** — storage paths should use opaque identifiers rather than names or addresses.
- **Audit trail** — preserve who uploaded each photo and when.
- **Retention** — a future retention/deletion policy for proof-of-delivery images should be anticipated in the architecture, but is not required for V1.

Do not design photo storage as publicly accessible. Authorization must be enforced at the storage layer, not only through hidden UI elements.

---

# Photo Cellular-Data Requirements

Photo functionality (property photos, proof of delivery) remains a
future implementation phase — see DEVIN.md "Implementation Sequence" —
but government specifically raised **cellular-data usage** as a launch
concern, so the requirement is documented now so it is not missed later.

When photo upload is implemented:

- Original full-resolution phone photos must **never** be uploaded.
  Images are resized/compressed **client-side** before upload.
- Target delivery-documentation quality, not archival photography — a
  reasonable initial target is a maximum long dimension around 1600px
  with sensible JPEG/WebP compression, enough to identify a house,
  cistern, access point, or proof of delivery.
- Only the compressed copy is uploaded — never both the original and
  compressed versions.
- Unnecessary metadata (GPS, device info) is stripped; image
  orientation must still display correctly after compression.
- All compression numbers are centralized in one configuration module
  (`src/lib/domain/photoConfig.ts`) — never hard-coded at multiple call
  sites, so they can be tuned after real-world testing without hunting
  through the codebase.
- The user should be able to see the compressed upload size before/
  during upload (optional UX, but the architecture must make this size
  available).
- A clear, immediate error on compression/upload failure. Repeated
  automatic retries must never be allowed to silently consume excessive
  cellular data.

Required future test coverage before shipping photo upload (see
TECHNICAL.md "Photo Failure Testing Requirements"): a large modern
phone photo, a slow cellular connection, an interrupted upload, upload
retry behavior, browser memory usage with multiple photos, compression
failure, an unsupported image format, file-size validation, and
orientation correctness after compression.

---

# Saba Operational Timezone

All operational date/time display and calendar boundaries (e.g. "this
month," the driver decline-limit "day") use Saba local time
(`America/Puerto_Rico`, a fixed UTC-4 with no daylight saving), not the
timezone of whoever happens to be viewing the app or the server it runs
on. Firestore itself continues to store proper absolute timestamps —
only display and calendar-boundary calculations are Saba-local. See
TECHNICAL.md "Saba Operational Timezone" for implementation details.

---

# Statistics

Statistics are a V1 requirement.

The underlying data must support at minimum:

- Total requests
- Completed deliveries
- Total gallons distributed
- Open requests
- Requests older than configurable thresholds
- Average request-to-claim time
- Average request-to-delivery time
- Deliveries by driver
- Requests by village/area
- Requests by day/week/month
- Preferred-driver requests
- Preferred-driver requests successfully claimed by that driver
- Preferred-driver requests that expired into the open queue
- Disputed deliveries
- Requests currently awaiting customer confirmation (delivered, within
  the confirmation window)
- Driver online/offline activity where useful
- Dispatch offers sent, accepted, and declined, and acceptance rate
- Requests by source (submitted online vs entered by staff)
- Requests by dispatch priority (Normal / Urgent / Critical)
- Average delivery time by dispatch priority
- Critical requests currently outstanding
- Urgent requests currently outstanding

Never rank individual residents, villages, or drivers by urgency —
priority statistics are aggregate counts and timings only (see
"Privacy" below).

Gallons distributed are derived from each request's stored `gallons`
value (which equals `loads × 1,000`), not by multiplying the request
count by 1,000. A two-load request still counts as one completed
delivery but contributes 2,000 gallons.

Preserve raw events and timestamps rather than only storing aggregate statistics.

---

# WhatsApp Resident Ordering

WhatsApp is a **front end to the existing application**, not a
parallel system. A resident can message the government Water Delivery
WhatsApp number and, through a short guided conversation, create the
exact same kind of water request as the web app — for either 1 load
(1,000 gallons) or 2 loads (2,000 gallons) — using the same domain
functions, the same `waterRequests` collection, the same
priority/preferred-driver/duplicate rules, and the same driver dispatch
workflow. If a WhatsApp-created request ever behaved differently after
creation from a website request, that would be a design error.

This phase covers **resident ordering only**. Driver WhatsApp
functionality (going online/offline, offers, ACCEPT/DECLINE, DELIVERED)
is intentionally not built yet — see TECHNICAL.md "Future WhatsApp
Integration" for what remains for a later phase.

## Deterministic, not AI

The conversation is a fixed set of numbered menus and explicit
keywords (e.g. reply `1`, `2`, `CONFIRM`, `CANCEL`) — never free-form
AI/LLM interpretation or intent classification. Every step recognizes a
narrow, explicit set of replies and re-prompts on anything else. This
is a government public service: predictability and auditability matter
more than a clever conversational feel.

## Public number vs. Cloud API number

The number residents already see on the website/Terms/Privacy/Data
Deletion pages (`+599 416 5363`) is the intended long-term public
contact number. That does **not** automatically mean it is provisioned
as a Meta WhatsApp Business Platform (Cloud API) number — that is a
separate manual setup step in Meta Business Manager (see TECHNICAL.md
"Meta Setup Required"). Do not assume the two are already the same
number without confirming in the Meta dashboard.

## Resident Identity Strategy

WhatsApp messages arrive with only a sender phone number — that is
**not** treated as proof of account ownership by itself:

- **Exact unique match** — if the sender's (normalized) phone number
  matches exactly one registered resident's saved profile phone, that
  resident's account is used as the likely context for the
  conversation (subject to the same review/edit step below — it is
  never assumed silently correct).
- **No match** — the person continues as an **unregistered/manual
  customer**, using the exact same model as a dispatcher-created
  unregistered request (name/phone/village/directions, no Firebase Auth
  account created).
- **Multiple matches** — the system does **not** guess. It tells the
  resident their account could not be identified automatically and
  directs them to the website or the Water Delivery Office. "Check my
  current request" is similarly only offered to a uniquely matched
  registered resident — for an ambiguous or unregistered phone number,
  status lookup is not offered via WhatsApp at all, to avoid ever
  exposing one person's request to someone else who happens to share or
  reuse a phone number.

Phone comparison normalizes both sides to digits-only before comparing,
since saved profile phones are free-text and formatted inconsistently
(e.g. `+599 416 5363` vs `599-416-5363`).

This is a V1 strategy, not a permanent identity system — see "Future
Explicit Linking" below.

## Future Explicit Linking

A more robust future improvement (not built in this phase) would let a
resident explicitly link their WhatsApp number to their account (e.g.
`whatsappNumber: string | null`, `whatsappVerifiedAt: Timestamp | null`
on `UserProfile`), with an actual verification step, rather than
relying on a phone-number match against the profile's contact phone.
This is deliberately deferred — building a full verification/linking
workflow now would be premature for V1.

## Registered resident flow

For a uniquely matched resident, the conversation presents their saved
phone/village/delivery directions and asks them to confirm they are
still correct, or update them. An update is only ever applied to the
saved profile after the resident explicitly confirms the full corrected
request (the same `updateUserProfile()` used by the web Profile page —
never a WhatsApp-specific profile-write path, and never applied from
ambiguous free text without confirmation).

## Unregistered customer flow

For an unmatched phone number, the conversation collects name, village,
delivery directions, and a contact phone (defaulting to the sending
WhatsApp number, editable) — the same fields a dispatcher collects for
a walk-in/phone caller. No account is created.

## Request conversation

Collects the same canonical information as the web form: village (a
numbered menu — see "Village Selection" below), delivery directions,
persons affected, vulnerable/critical circumstances (canonical options
only — Elderly person / Infant or young child / Medical need /
Essential services (Commercial/business) / Hotel or Restaurant / None),
available storage capacity (free text), resident-reported urgency
(Normal / Critical, with a required explanation for Critical — enforced
by the exact same `buildWaterSituationSnapshot()` validation the web
form uses, never re-implemented), and **quantity** (1 load / 2 loads,
a numbered menu just like urgency). An optional preferred-driver
selection is offered from the same eligible-driver list the web app
uses; it remains a preference, never a guarantee, exactly as on the
web.

### Village Selection

A canonical five-village list now exists in `src/lib/domain/villages.ts`
and is shared by the resident profile form, the dispatcher manual-request
forms, the WhatsApp conversation, and server-side validation: St Johns,
The Bottom, Windwardside, Zions Hill - Lower, Zions Hill - Upper. Any
village value outside this set is rejected when a profile or request is
saved. Old spellings (`St. John's`, `Zion's Hill`, etc.) are no longer
accepted; a one-time migration script (`scripts/migrate-villages.mjs`)
can clean up prelaunch Firestore documents.

## Attestation

Before submission, the resident sees a plain-text summary (name,
village, quantity, persons affected, reported priority, preferred driver)
and must reply `CONFIRM` to submit or `CANCEL` to stop — no earlier
"yes" in the conversation is treated as the attestation. Confirming
records `attestationAccepted: true` / `attestationAcceptedAt`, exactly
like the web form's final "Request Water" step.

## Request source

Requests created this way are tagged `source: "whatsapp"`. Like a
resident's own web submission (and unlike a dispatcher-created
request), a WhatsApp submission is a **self-service action by the
customer themselves**, not a staff action taken on their behalf — so it
deliberately reuses the existing `request_created` audit event (with
`source: "whatsapp"` already recorded on the request document itself)
rather than introducing a new event type. Dispatcher staff can see
"Submitted via WhatsApp" on the request detail page, and `/statistics`
breaks out WhatsApp alongside resident/dispatcher request counts.

## Duplicate protection

Exactly the same protection as the web/dispatcher workflow:

- A uniquely matched **registered** resident with an existing
  unresolved request is hard-blocked from creating a second one — they
  are shown that request's current status instead.
- An **unregistered** WhatsApp customer with a phone-matching
  unresolved request is also blocked and shown that request's status.
  Unlike the dispatcher UI, WhatsApp does **not** offer a
  "proceed anyway" override for a soft phone match — a dispatcher can
  apply human judgment (e.g. a shared household phone) before
  overriding; an unattended, unauthenticated WhatsApp conversation
  cannot, so a phone match is treated as decisive there. A resident in
  that situation is directed to the Water Delivery Office.

## Checking status and delivery confirmation/dispute

"Check my current request" (registered residents only — see "Resident
Identity Strategy" above) reports a resident-friendly status label
(e.g. "Waiting for a driver," "Driver assigned," "Delivery marked
complete, awaiting your confirmation," "Delivery disputed — under
review") — never a raw status enum string. If the request is
`delivered`, the resident can immediately confirm ("Yes, received") or
report a problem ("No, there is a problem" + a short reason) — using
the exact same `confirmWaterDelivery()` / `disputeWaterDelivery()`
functions the resident web portal uses.

## Session privacy and expiration

An in-progress conversation is stored server-side
(`whatsappSessions/{id}`) purely as scratch state for the current
conversation — it is never the authoritative record of a water request,
and no client (resident, driver, or staff) has direct read/write access
to it; only the webhook route (via the Admin SDK) does. An incomplete
conversation expires after 24 hours (`appConfig.whatsappSessionExpirationHours`)
— matching WhatsApp's own 24-hour customer-service messaging window —
after which a new message starts a completely fresh conversation rather
than resuming stale draft answers.

## Error handling

Every failure path (duplicate request, invalid village/number, expired
session, missing Critical explanation, a preferred driver no longer
available, the request state changing mid-conversation, or the backend
being temporarily unavailable) gets a short, resident-friendly message
that directs them to try again or contact the Water Delivery Office.
Raw Firebase errors, stack traces, document IDs, and internal enum
names are never sent to a resident over WhatsApp.

## Not yet implemented

- Driver WhatsApp workflow (online/offline, offers, accept/decline,
  delivered) — see TECHNICAL.md "Future WhatsApp Integration".
- WhatsApp message templates / proactive outbound notifications outside
  the resident-initiated conversation window.
- Explicit WhatsApp-number-to-account linking/verification (see "Future
  Explicit Linking" above).

---

# Operational Continuity Snapshot

Government raised a continuity question ahead of the next testing round:
what happens to outstanding deliveries if the application becomes
unavailable — internet outage, website outage, planned maintenance, a
Vercel outage, or a Firebase/application issue? Drivers and dispatchers
need a way to keep working from the last known state even if the system
itself is temporarily unreachable.

## What it is

A nightly (and on-demand) snapshot PDF of the outstanding delivery
queue at the moment it is generated:

- **Unassigned Loads** — requests not yet claimed by a driver
  (`available`, `preferred_driver_hold`, and any legacy `requested`
  state), each with: priority, customer/requestor name, phone, village,
  delivery directions, requested time, age, preferred driver (if any),
  and gallons.
- **Assigned Loads** — requests currently `claimed` by a driver, each
  with: priority, customer/requestor name, phone, village, delivery
  directions, assigned driver, requested time, claimed time, and
  gallons.

`delivered`/`confirmed`/`cancelled` requests are excluded — a delivered
request's physical delivery has already occurred, so it is not
outstanding driver work. This is a deliberately simple V1 (see DEVIN.md
"Do Not Overbuild"); a separate "delivered, awaiting confirmation"
section was considered but not built, since it would not help a driver
or dispatcher continue delivering water during an outage — it can be
added later if a genuine operational need for it appears.

The snapshot never includes the resident's vulnerable-circumstance
details, persons-affected count, or Critical explanation — see "Water
Situation Privacy" above. It contains only what staff need to manually
continue fulfilling deliveries.

## Delivery

- **Nightly**: emailed automatically at **8:00 PM Saba time** to a
  configured government operational address (see TECHNICAL.md
  "Operational Continuity Snapshot" for the scheduling/email
  implementation and required environment configuration).
- **Manual download**: a "Generate Continuity Report" action is
  available to dispatcher/admin staff at any time — useful before
  planned maintenance, before a storm, when internet reliability is
  questionable, or during testing. It only downloads the PDF and never
  sends an email.
- **Manual send**: a separate "Send Continuity Report Now" action lets
  dispatcher/admin staff immediately email the current snapshot (e.g.
  to confirm delivery is working, or right before an expected outage)
  without waiting for the nightly schedule. Both manual actions, and
  the nightly job, produce the exact same report using the same code
  (never a second implementation).

## Privacy

The report contains operational/customer information (names, phone
numbers, delivery directions) and must never be publicly accessible. It
is generated on demand and streamed directly to an authorized
dispatcher/admin session, or emailed to a private, configured address —
it is never published at a guessable public URL.

## Not a replacement for the system

This is a backup/continuity aid, not a parallel dispatch system. It does
not let drivers claim or update requests offline, and generating it
never changes any request's or driver's state — see TECHNICAL.md
"Reliability" for why this must remain a strictly read-only operation.

---

# Payments

Payments are explicitly outside V1 scope.

Current business process:

- Customer pays the driver.
- Driver pays government for the water.
- Driver retains the delivery portion.

Government may restrict a driver's delivery access for non-payment.

Do not build:

- Customer payment processing
- Driver billing
- Government accounting
- QuickBooks integration
- Automated driver balance calculations

The architecture should not prevent these capabilities from being added later.

---

# WhatsApp

WhatsApp integration is planned but is **not part of the initial web implementation**.

Future driver functionality may include:

- Going online/offline through WhatsApp
- Receiving available assignments
- Claiming deliveries
- Viewing current jobs
- Marking deliveries complete

Future customer functionality may include:

- Request notifications
- Driver assignment notifications
- Delivery confirmation

Firestore remains the source of truth.

WhatsApp will be an interface to the same application logic, not a separate dispatch system.

---

# V1 Priority

Build the web-based workflow first.

The priority order is:

1. Authentication and roles
2. Customer request workflow
3. Driver queue and claiming
4. Driver delivery workflow
5. Customer confirmation
6. Dispatcher/admin controls
7. Statistics
8. WhatsApp integration later

The success criterion for V1 is simple:

**A resident can request water without calling individual drivers, an eligible driver can claim and deliver it, government can see the entire process, and the resulting operational data is reliable.**

## Immediate roadmap (not yet implemented)

The following items are explicitly out of scope for the current pass and
must not be treated as built until a separate work item documents and
implements them:

1. **Driver-facing special delivery conditions** — a way for a driver to
   record non-standard delivery notes (e.g. extra hose, specific gate,
   accessibility issue) on a per-load basis. This is not in the data
   model or UI today.
2. **Statistics "Last 24 Hours" view** — a statistics period shorter than
   the existing week/month/year/all options. The current statistics pages
   do not offer a 24-hour filter.