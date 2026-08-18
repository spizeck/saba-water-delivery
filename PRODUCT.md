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

## Driver

Drivers can:

- Log in.
- Set themselves online or offline.
- View requests they are eligible to claim.
- Claim an available delivery.
- View their claimed deliveries.
- Access customer delivery information.
- Mark a delivery as delivered.
- Upload proof-of-delivery photos (planned).
- View their delivery history.

Government staff may restrict a driver's delivery access.

An ineligible driver cannot claim new deliveries regardless of their online/offline preference.

## Dispatcher

Dispatchers can:

- View all water requests.
- Create a request for a customer who calls or visits the office.
- View request status and history.
- Assign or reassign requests when necessary.
- Handle delivery problems and disputes.
- View operational statistics.

## Administrator

Administrators have dispatcher capabilities plus system-management capabilities such as:

- Managing drivers.
- Restricting/restoring driver delivery access.
- Managing application settings.
- Managing user roles.

Dispatcher and administrator should be separate roles even if their permissions overlap initially.

---

# Standard Water Request

Every request represents:

**1,000 gallons**

Do not allow arbitrary quantities in V1.

A resident normally requests delivery:

**ASAP**

Scheduled delivery dates and time slots are outside the initial scope.

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

# Open Request Queue

Drivers should be able to view available water requests through the web interface.

Open requests should default to oldest-first ordering.

The system should avoid designs that encourage drivers to select customers based on personal relationships.

When a driver claims a request, the claim must be atomic so two drivers cannot successfully claim the same delivery.

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