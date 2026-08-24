# Dispatcher Guide

A practical guide to the dispatcher dashboard for daily operational use.
For the underlying business rules, see [`PRODUCT.md`](../PRODUCT.md);
for a plain-English overview of the whole day, see
[`OPERATIONS.md`](./OPERATIONS.md).

## Logging in

Sign in at `/login` with your government account. You will be taken to
the dispatcher dashboard automatically if `dispatcher` or `admin` is
your only role; if you hold multiple roles, use the portal switcher in
the header to reach the dispatcher dashboard.

## The dispatcher dashboard

The dashboard shows outstanding operational activity at a glance:
new/open requests, preferred-driver holds, claimed requests, aging
requests, deliveries awaiting resident confirmation, disputes, and any
drivers currently marked ineligible.

## Creating a manual request

Use **Create Request** for a resident who calls or visits the office.

- **Registered resident:** search by name, phone, or email and select
  their account. Their saved village and delivery directions are
  pre-filled — you may adjust either for this request only, without
  changing what is saved on their profile.
- **Unregistered customer:** enter their name, phone, village, and
  delivery directions directly. No account is created and none is
  required.

Either way, review the details and submit — this enters the exact same
queue as a request submitted from the website or WhatsApp.

### Duplicate warnings

- A registered resident who already has an unresolved request cannot
  have a second one created — you will see their existing request
  instead.
- An unregistered customer with a matching phone number on an
  unresolved request will trigger a warning showing that request. A
  matching phone number is not proof of identity (for example, a
  shared household phone), so you may confirm and proceed anyway if
  appropriate. Doing so is recorded, never silent.

## Priority

Every request receives an initial priority automatically: **Critical**
if the resident indicated a vulnerable circumstance or a
self-reported critical situation (with a required written
explanation), otherwise **Normal**. **Urgent** is never assigned
automatically — it is only ever set by a dispatcher or admin.

### Priority override

Open a request and use **Change Priority** to set it to Normal,
Urgent, or Critical. A reason is required and is recorded, along with
who made the change and when. Use this when your judgment differs from
the automatic assessment, for example escalating a situation the
resident under-described, or correcting a mistaken Critical claim.

## Preferred driver

A resident may name a preferred driver. That driver has first access to
claim the request for a limited window (24 hours by default). This is
a preference, not a guarantee: if the preferred driver is offline,
ineligible, in cooldown, or already on another delivery, an
Urgent/Critical request skips the hold entirely and goes straight to
the general queue rather than waiting. If the preferred driver
declines, the hold ends immediately either way.

## Assignment and reassignment

You can manually reassign a request to a different driver when
operationally necessary (for example, a driver becomes unavailable
mid-delivery). Reassignment preserves the request's original submitted
time in the fairness queue.

## Delivery state and disputes

Once a driver marks a request delivered, the resident has 24 hours to
confirm receipt or report a problem. If they report a problem, the
request becomes **Disputed** and appears on your dashboard for
resolution. If the resident does not respond in time, the system
automatically confirms the delivery so it does not sit open forever.

For an **unregistered customer** (no account to confirm through), use
**Confirm Delivery** on the request detail page once the driver has
marked it delivered — this is recorded as a staff confirmation, not a
customer confirmation, so the record always reflects what actually
happened.

## Statistics

`/statistics` (also reachable from "View Statistics") shows demand
trends, delivery timing, driver activity, preferred-driver usage, and
dispute rates over a selectable period (last 7/30 days, this
month/year, or all time).

## Continuity report

- **Generate Continuity Report** downloads a PDF snapshot of every
  request that has not yet been delivered, for your own reference or
  to prepare for an outage. It does not send any email.
- **Send Continuity Report Now** immediately emails that same snapshot
  to the configured government recipients, without waiting for the
  automatic 8:00 PM send. Use this before an expected outage or to
  confirm email delivery is working.

See [`OPERATIONS.md`](./OPERATIONS.md) "End of day" and
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for why this report
exists and how to use it during an outage.
