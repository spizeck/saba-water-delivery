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

## Batch Dispatch

Use **Batch Dispatch** (from the dispatcher dashboard) when you need to
assign several loads to one driver at once instead of letting them
come in one at a time through the app — most often for a driver whose
phone or data connection is unreliable. This is a separate, deliberate
tool from the normal driver dispatch flow; it does not change how
individual drivers normally receive one offer at a time.

### Creating a batch

1. Open **Batch Dispatch** and select **+ New Batch**.
2. **Choose a driver.** Only eligible, account-linked drivers appear.
   The driver does not need to be online, and being in a decline
   cooldown does not stop you from assigning them a batch — this is a
   deliberate override of the normal offer flow. Their online/offline
   and cooldown status, and whether they already have an active
   delivery, are shown so you can decide with full information.
3. **Choose loads.** The list shows every outstanding request not yet
   claimed by anyone, in the normal fairness order (highest priority
   first, oldest first within a priority). Check as many as you need —
   there is a generous maximum per batch, shown on screen.
4. If a load is held for a **different** resident's preferred driver,
   it is clearly flagged. Selecting it requires you to check a box
   acknowledging that you are overriding that preference — it is never
   overridden silently.
5. **Review** the full list, driver, and total gallons, then confirm.

If anything about a selected load changed while you were reviewing it
(for example, another driver claimed it in the meantime), the batch
will not be created and you will need to review and try again — this
is intentional, so a batch is never partially assigned.

### The dispatch sheet

Confirming a batch takes you to its detail page, where you can
download a printable **Driver Dispatch Sheet** — a simple PDF listing
every load in order with the customer's name, phone, village,
directions, and a checkbox/notes area for tracking completion on
paper. You can **reprint** it at any time; a reprint always reflects
the batch's current state (for example, a load already delivered shows
as delivered rather than a blank checkbox), not a frozen copy of the
original assignment.

### Completing batch loads

Each load is still delivered and confirmed individually — there is no
single button that marks a whole batch delivered. If the driver has
app access, they mark each load delivered themselves, exactly like any
other claimed delivery. If the driver cannot use the app, open the
batch and use **Record Delivery (paper reconciliation)** on that
specific load after verifying with the driver that it was actually
delivered. This is only available for batch-assigned loads.

### Reassigning or cancelling a batch load

If one load in a batch needs to go to a different driver, or needs to
be cancelled, use the same **Reassign** or **Cancel** actions you would
use for any request from its detail page. That load simply leaves the
batch — the rest of the batch is unaffected.

## Statistics

`/statistics` (also reachable from "View Statistics") shows demand
trends, delivery timing, driver activity, preferred-driver usage, and
dispute rates over a selectable period (last 7/30 days, this
month/year, or all time).

## Continuity report

- **Generate Continuity Report** downloads a PDF snapshot of every
  request that has not yet been delivered, for your own reference or
  to prepare for an outage. It does not send any email. This includes
  batch-assigned loads (marked "(Batch)") alongside normal claims — a
  batch assignment never hides a load from this report.
- **Send Continuity Report Now** immediately emails that same snapshot
  to the configured government recipients, without waiting for the
  automatic 8:00 PM send. Use this before an expected outage or to
  confirm email delivery is working.

See [`OPERATIONS.md`](./OPERATIONS.md) "End of day" and
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for why this report
exists and how to use it during an outage.
