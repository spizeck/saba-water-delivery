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

Use **Create Request** for a requestor who calls or visits the office.
The form asks first for the **Requestor** (registered resident or new /
unregistered person), then the **Delivery location** and other request
details, and finally shows a **Review request** screen for confirmation.

- **Registered resident:** search by name, phone, or email. Click a
  result to select that resident. The search list collapses into a
  compact **Selected requestor** card. Their saved area is shown for
  reference; if it is a legacy value that is no longer one of the
  approved villages, it is marked "Needs update" and the **Delivery
  location** field is left empty for you to select a canonical village.
  Click **Change** to clear the selection and search again.
- **Unregistered requestor:** enter their name, phone, email if they
  have one, village, and delivery directions directly. No account is
  created and none is required.

### Online account options (optional)

For an unregistered requestor, the **Online account** section on the
request form is always optional:

- **No email entered:** the requestor can continue without an online
  account. Their request history may be linked later if they create an
  account.
- **Email already has an account:** if the email matches an existing
  resident, you can select that existing account so the request is
  registered. Otherwise you can leave it unregistered.
- **New email:** you can check **Send account setup instructions** to
  email the requestor a secure link to set their own password. The water
  request is still created whether or not the invitation succeeds. You
  never know or set anyone's password.

In both cases the village/directions you enter apply to **this request
only** and never overwrite a registered resident's saved profile.

**Notes / Comments (optional):** add other request-specific information or
questions that do not fit the structured fields. The review screen shows the
note before submission. It is stored only on this request, appears to the
driver, and does not update the requestor's saved profile.

**Quantity:** for either type of requestor, you must select whether the
request is for **1 load (1,000 gallons)** or **2 loads (2,000
gallons)**. A two-load request is still a single request — it gets one
priority, one assignment, and one confirmation/dispute record.

Either way, review the details and click **Create Request** — this
enters the exact same queue as a request submitted from the website or
WhatsApp.

### Duplicate and frequent-request warnings

- A registered resident who already has an unresolved request cannot
  have a second one created — you will see their existing request
  instead.
- An unregistered requestor with a matching phone number on an
  unresolved request will trigger a warning showing that request. A
  matching phone number is not proof of identity (for example, a
  shared household phone), so you may confirm and proceed anyway if
  appropriate. Doing so is recorded, never silent.
- If a requestor has **3 or more water requests in the last 7 days**,
  the Create Request form and the request detail page show a
  non-blocking "Frequent delivery activity" warning. This is awareness,
  not enforcement — you can still create or dispatch the request. The
  count is based on rolling request timestamps, not calendar weeks.

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

## Escalating a request

You can move an open request ahead in the dispatch queue without
changing its priority or its original request time. Use **Escalate** on
a request when operational circumstances require it (for example, a
vulnerable resident or an urgent follow-up). You must provide a reason;
the action is recorded in the audit trail. Multiple escalated requests
at the same priority remain oldest-first, so escalation does not
randomize the queue or make newer requests jump ahead of older ones.

## Assignment and reassignment

You can manually reassign a request to a different driver when
operationally necessary (for example, a driver becomes unavailable
mid-delivery). Reassignment preserves the request's original submitted
time in the fairness queue.

If you see "Selected driver already has an active delivery" but the
driver believes they have no active work, the system will
automatically check and clear the outdated reference the next time the
driver opens the driver portal or you attempt the assignment again.
This can happen when old prelaunch test data was deleted without
clearing the driver's internal reference.

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

## Water Collection Reconciliation

On claimed request detail pages, you can see the water collection status for each load.

- If a driver cannot record collection — for example, a paper delivery run or phone confirmation — staff can record it on the driver's behalf.
- Click **Record collection** for each missing load, select the fill station, and verify the meter.
- A verification note is required when staff record collection for a driver.
- All loads must have collection records before staff can mark a delivery as complete.
- Staff collection recordings are tracked separately in the audit trail.

## Delivery Runs

Use **Delivery Runs** (from the dispatcher dashboard) when you need to
assign several deliveries to one driver at once instead of letting them
come in one at a time through the app — most often for a driver whose
phone or data connection is unreliable, or for a planned delivery
route. The driver can use the app, or you can print a run sheet for
them. This is a separate, deliberate tool from the normal driver
dispatch flow; it does not change how individual drivers normally
receive one offer at a time.

### Creating a delivery run

1. From the dispatcher dashboard, select **New Delivery Run**.
2. **Choose a driver.** Only eligible, account-linked drivers appear.
   The driver does not need to be online, and being in a decline
   cooldown does not stop you from assigning them a run — this is a
   deliberate override of the normal offer flow. Their online/offline
   and cooldown status, and whether they already have an active
   delivery, are shown so you can decide with full information.
3. **Choose requests.** The list shows every outstanding request not yet
   claimed by anyone, in the normal fairness order (highest priority
   first, oldest first within a priority). Check as many as you need —
   there is a generous maximum per run, shown on screen. Each request
   displays its quantity (e.g., 2 loads / 2,000 gallons) as one entry.
4. If a request is held for a **different** resident's preferred driver,
   it is clearly flagged. Selecting it requires you to check a box
   acknowledging that you are overriding that preference — it is never
   overridden silently.
5. **Review** the summary showing the driver name, request count, load
   count, and total gallons. Click **Create Delivery Run** to confirm.

If anything about a selected request changed while you were reviewing it
(for example, another driver claimed it in the meantime), the run
will not be created and you will need to review and try again — this
is intentional, so a run is never partially assigned.

### The run sheet

Creating a delivery run takes you to its detail page, where you can
download a printable **Delivery Run Sheet** — a simple PDF listing
every request in order with the customer's name, phone, village,
quantity (loads and gallons), directions, and a checkbox/notes area for
tracking completion on paper. You can **reprint** it at any time; a
reprint always reflects the run's current state (for example, a
request already delivered shows as delivered rather than a blank
checkbox), not a frozen copy of the original assignment.

### Run lifecycle

Each delivery run has an operational state derived from its member
requests:

- **In Progress** — at least one request is still claimed (not yet
  delivered). The driver's workload reflects these outstanding loads.
- **Awaiting Confirmation** — every request has been physically
  delivered, but at least one is still awaiting resident confirmation.
  The driver is no longer operationally busy.
- **Completed** — every request is confirmed or disputed, or no
  requests remain in the run. The run is no longer shown as active.

### Completing deliveries in a run

Each request is still delivered and confirmed individually — there is no
single button that marks a whole run delivered. A two-load request
appears as one entry; marking it delivered means the full requested
quantity (2,000 gallons) was delivered. If the driver has app access,
they mark each request delivered themselves, exactly like any other
claimed delivery. If the driver cannot use the app, open the run and
use **Mark Delivered** on that specific request after verifying with the
driver that it was actually delivered. Driver- and staff-recorded delivery use
the same notification workflow: a registered resident with an email receives a
**Review Delivery** link. Unregistered or unclaimed requestors are not emailed
an authenticated link; continue the existing staff verification process for
them.

Use **Edit request** before claim to change Notes / Comments. The change is
included in the normal request edit audit entry.

### Reassigning or cancelling a run request

If one request in a run needs to go to a different driver, or needs to
be cancelled, use the same **Reassign** or **Cancel** actions you would
use for any request from its detail page. That request simply leaves the
run — the rest of the run is unaffected.

### Closing an orphaned run

If a delivery run shows as active but all its requests have already been
reassigned or cancelled, use **Close Run** on the run's detail page to
mark it completed. This is only available when no requests remain claimed.

## Statistics

`/statistics` (also reachable from "View Statistics") shows demand
trends, delivery timing, driver activity, preferred-driver usage, and
dispute rates over a selectable period (last 7/30 days, this
month/year, or all time).

## Continuity report

- **Generate Continuity Report** downloads a PDF snapshot of every
  request that has not yet been delivered, for your own reference or
  to prepare for an outage. It does not send any email. This includes
  delivery-run-assigned loads (marked "(Delivery Run)") alongside
  normal claims — a delivery run never hides a load from this report.
- **Send Continuity Report Now** immediately emails that same snapshot
  to the configured government recipients, without waiting for the
  automatic 8:00 PM send. Use this before an expected outage or to
  confirm email delivery is working.

See [`OPERATIONS.md`](./OPERATIONS.md) "End of day" and
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for why this report
exists and how to use it during an outage.
