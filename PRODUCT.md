# Water Delivery System

## Purpose

Create a fair, centralized system for residents to request government-produced RO water and for authorized water delivery drivers to fulfill those requests.

The system replaces the current process where customers contact individual drivers directly.

The government water system, not an individual driver, owns the request.

## Core Principles

1. **Equal access to water**
   - Customers should not need a personal relationship with a driver to receive water.
   - Open requests should be equally accessible to eligible drivers.

2. **Simple for residents**
   - A standard water request is always one 1,000-gallon load.
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
- Request one 1,000-gallon load of water.
- Request delivery ASAP.
- Optionally select a preferred driver.
- View current request status.
- View previous requests and deliveries.
- Confirm that a delivery was received.
- Report that a delivery marked delivered was not received.
- Upload property photos to help drivers locate the delivery point (planned).

Authentication should initially support:

- Google
- Facebook
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

An admin can also **unlink** an account later. Unlinking is blocked
while the driver has active claimed deliveries (those must be resolved
or reassigned first), and always preserves the registry record, driver
history, and delivery history.

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
functionality. Eligibility (`drivers/{uid}.eligibilityStatus == "eligible"`)
determines whether a driver may actually claim deliveries. These are separate
concepts.

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
- Adding/removing operational roles (driver, dispatcher, admin).
- Restricting/restoring driver delivery access.
- Managing application settings, including the driver decline limit and
  cooldown hours used by the dispatch offer workflow.

Role management safeguards:

- Admins cannot remove their own admin role (self-lockout protection).
- The last system admin cannot be removed (system lockout protection).
- Adding the `driver` role does NOT by itself make someone an
  operational driver — see "Driver Registry" above. Operational drivers
  are entered and linked separately.
- Removing the driver role is blocked when active deliveries exist, and
  automatically unlinks the driver's Driver Registry entry if one exists.
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

Every request represents:

**1,000 gallons**

Do not allow arbitrary quantities in V1.

A resident normally requests delivery:

**ASAP**

Scheduled delivery dates and time slots are outside the initial scope.

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

A dispatcher can search for a resident by name, phone, or email and
select them, pre-filling their saved village and delivery directions. The
dispatcher may adjust delivery directions (and village) **for this
request only** — this never overwrites the resident's saved profile.

The existing one-active-request-per-resident rule is preserved exactly:
if the resident already has an unresolved request, the dispatcher sees
this clearly before submitting and cannot create a duplicate. Resolving
that conflict uses the same dispatcher tools already available for any
request (reassign, cancel, resolve a dispute, etc.).

## Unregistered customers

A resident must **not** be required to create an application account
just to receive government water. A dispatcher can create a request for
someone with no account by entering:

- Customer name (required)
- Phone number (required)
- Village/area (required)
- Delivery directions (required)
- Email (optional)

No Firebase account is created for this customer, and none is required.

Because an unregistered customer has no stable account identity, exact
duplicate detection is not possible the way it is for a registered
resident. Instead, the dispatcher is warned when an unresolved request
already exists with a matching phone number, and shown that existing
request. Phone matching is **not** treated as proof of identity — a
dispatcher may deliberately proceed anyway (e.g. a shared household
phone), and doing so is recorded, never silent.

## Future account linking

An unregistered customer's past requests could eventually be associated
with a registered account if that customer signs up later. This is
**not implemented yet** — do not automatically link requests by name
alone. Any future linking should be a deliberate, staff-initiated,
auditable action, potentially assisted by matching phone/email, not an
automatic background process.

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

---

# Driver Availability

Driver operational status and government authorization are separate concepts.

A driver can set:

- `online`
- `offline`

Government controls whether the driver is:

- `eligible`
- `ineligible`

An eligible, online driver can claim eligible requests.

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

The driver sees:

- Customer name
- Village
- 1,000 gallons
- Request age
- Delivery directions

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

---

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

---

# Delivery Confirmation

After delivering water, the driver marks the request as delivered.

The customer is then asked to confirm receipt.

Customer options:

- **Yes, received**
- **No, there is a problem**

If confirmed:

`DELIVERED → CONFIRMED`

If rejected:

`DELIVERED → DISPUTED`

If the customer does not respond within a configurable period, the request may become:

`DELIVERED_UNCONFIRMED`

The system must preserve the driver's delivery timestamp and customer's confirmation timestamp separately.

## Unregistered customers

An unregistered customer has no authenticated resident portal to confirm
or dispute through. Their delivery is never automatically marked
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
- Delivered but unconfirmed requests
- Driver online/offline activity where useful
- Dispatch offers sent, accepted, and declined, and acceptance rate
- Requests by source (submitted online vs entered by staff)

Because every completed request represents 1,000 gallons:

`completed deliveries × 1,000 = gallons distributed`

Preserve raw events and timestamps rather than only storing aggregate statistics.

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