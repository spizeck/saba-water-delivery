# Operations Guide

This guide explains a normal operating day for the Saba government
water-delivery system. It is written for dispatchers, drivers, and
supervisors, not developers. For step-by-step screen instructions, see
[`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md), [`DRIVER_GUIDE.md`](./DRIVER_GUIDE.md),
and [`ADMIN_GUIDE.md`](./ADMIN_GUIDE.md).

## Beginning of day

- Dispatchers should log in and check the dispatcher dashboard for:
  - Any requests still outstanding from overnight.
  - Deliveries marked complete that are awaiting resident confirmation.
  - Any unresolved disputes.
  - Drivers currently marked ineligible or in a decline cooldown.
- Drivers should log in, confirm their account is still eligible, and
  go online when ready to receive deliveries.

## Resident request lifecycle

In plain terms, a request moves through the system like this:

1. **Request** — a resident submits a request (on the website, over
   WhatsApp, or a dispatcher enters it for someone who called or
   visited the office).
2. **Preferred-driver hold** (if the resident chose a preferred
   driver) — that driver has first access to the request for a limited
   time.
3. **Available** — the request is open to the next eligible online
   driver.
4. **Claimed** — a driver has accepted the delivery.
5. **Delivered** — the driver has delivered the water.
6. **Confirmed / Disputed** — the resident confirms they received the
   water, reports a problem, or, if they never respond, the system
   automatically marks the delivery confirmed after 24 hours so a
   request never sits open indefinitely.

Urgent and critical requests move ahead of normal requests in the
queue, but a request never loses its place due to a decline, an
expired hold, or reassignment — its original request time is always
preserved.

## Driver workflow

- A driver chooses when to go online or offline. This never affects
  their government eligibility to deliver.
- An online, eligible driver is offered exactly one delivery at a
  time — never a list to browse. This keeps access to work fair across
  all drivers.
- The driver accepts or declines each offer. Declining too many offers
  in a day pauses new offers for that driver for a cooldown period
  (both numbers are set by an administrator).
- Once a driver accepts a delivery, they cannot be offered a second one
  until they mark the first one delivered. The resident's later
  confirmation does not hold the driver up — the driver is free for the
  next offer the moment they mark a delivery complete.
- A driver may occasionally see several deliveries assigned at once,
  each marked as a batch assignment. This means a dispatcher
  deliberately assigned them a group of loads through Batch Dispatch —
  it does not change how each delivery is completed, and it does not
  affect the driver's normal one-offer-at-a-time experience the rest
  of the time.

## Dispatcher workflow

- Dispatchers monitor the dashboard throughout the day for new
  requests, aging requests, deliveries awaiting confirmation, and
  disputes.
- Dispatchers can reassign a request to a different driver, override
  priority (with a reason), and resolve disputes.
- Dispatchers can enter a request for a resident who cannot use the
  website — see "Manual requests" below.
- For a driver who needs several requests assigned at once — most often
  a driver whose phone or data connection is unreliable — dispatchers
  can use **Batch Dispatch** to assign a group of requests together and
  print a driver dispatch sheet. This is a deliberate exception,
  separate from the normal one-offer-at-a-time driver workflow above —
  see "Batch Dispatch" below.

## Batch Dispatch

Batch Dispatch lets a dispatcher assign several outstanding requests to
one driver at once, instead of the driver receiving them one at a time
through the app. Use it when:

- A driver's phone or data connection cannot be relied on for the
  whole day, and it is more practical to hand them a printed list of
  deliveries.
- Staff are planning a run for a driver ahead of time.

The dispatcher selects the driver and the requests, reviews the list, and
confirms. This produces a printable "Driver Dispatch Sheet" listing
every request with the customer's name, phone, village, quantity
(loads and gallons), directions, and a simple checkbox/notes area for
the driver (or a dispatcher, if the driver cannot use the app) to mark
off as each request is completed.

Each request in a batch is still delivered and confirmed individually,
exactly like any other request — Batch Dispatch does not change how a
delivery is completed, only how it was assigned. A two-load request
appears as one entry and is delivered as one request. See
[`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md) for the step-by-step
screens.

## Manual requests

Not every resident can or will use the website. If someone calls the
office or visits in person, a dispatcher enters the request directly
using "Create Request" — either by finding their existing account or,
if they have none, by entering their name, phone, village, and
delivery directions. For all manual requests the dispatcher must also
select the quantity: **1 load (1,000 gallons)** or **2 loads (2,000
gallons)**. A two-load request is still a single request document with
one priority, one assignment, and one confirmation/dispute record. This
is a normal request, not a special case: it goes through the exact same
queue, priority, and driver-assignment rules as any other request.

Villages must be chosen from the approved list (St Johns, The Bottom,
Windwardside, Zions Hill - Lower, Zions Hill - Upper). Free-text
villages are no longer accepted. Any legacy spellings in prelaunch data
are cleaned with the one-time `scripts/migrate-villages.mjs` migration
script before go-live; unapproved or ambiguous values are reported, not
silently mapped.

## WhatsApp requests

Residents can also request water by messaging the government WhatsApp
number. These requests enter the same system and the same queue as
website and dispatcher-created requests — there is nothing different
for staff or drivers to do with a WhatsApp request. The request detail
page shows "Submitted via WhatsApp" so staff know how it arrived.

WhatsApp is a front end to the same underlying system, not an
independent backup channel — it depends on the same Firestore database
as the website. If the website is unavailable because of a Firebase
outage, WhatsApp ordering is affected in the same way. See
[`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for exactly which
outages affect which channels.

## End of day

At 8:00 PM Saba time, the system automatically generates and emails an
Outstanding Delivery Snapshot report to the configured government
recipients. This report lists every request that has not yet been
delivered (unassigned and currently-assigned requests) so that, if the
website or internet becomes unavailable, staff and drivers still have
a paper/PDF record of exactly what water still needs to be delivered
and to whom. See [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) for
how to use this report during an outage.

Dispatchers can also generate this report at any time (for example,
before a storm, or when testing) using "Generate Continuity Report" on
the dispatcher dashboard, and can send it by email immediately with
"Send Continuity Report Now" without waiting for 8:00 PM.
