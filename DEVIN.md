# Devin Development Guide

## Project

This repository contains a Next.js web application for managing government RO water delivery requests.

Read `PRODUCT.md` and `TECHNICAL.md` before making architectural or product decisions.

When these documents conflict with assumptions made from existing code, stop and identify the conflict rather than silently changing the product behavior.

---

# Primary Objective

Build a simple, reliable web application that replaces the current process where residents must individually contact water delivery drivers.

The system must provide:

**Resident requests water → eligible driver claims request → driver delivers water → resident confirms delivery → government retains complete operational visibility and statistics.**

Every load is exactly **1,000 gallons**.

---

# Development Philosophy

Prefer:

- Simple implementations
- Explicit domain logic
- Strong typing
- Small reusable components
- Server-side authorization
- Clear Firestore data ownership
- Mobile-first responsive interfaces
- Auditable state transitions
- Maintainability over cleverness

Avoid speculative architecture.

Do not implement future features simply because they are mentioned in planning documents.

---

# Stack

Use:

- Next.js App Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Storage (for property and delivery photos)
- Firebase Admin SDK where trusted server operations are required
- Vercel

Follow current Next.js App Router conventions.

Default to Node.js runtime unless there is a concrete reason to use another runtime.

---

# Authentication

Implement Firebase Authentication supporting:

- Google
- Facebook
- Email/password

Roles:

```text
resident
driver
dispatcher
admin
```

A single user may hold **multiple roles** (`roles: UserRole[]`). New users
default to `["resident"]`. Roles are granted only via Admin SDK.

The application handles backward-compatible reads from documents that still have
a singular `role` field (wraps into an array). New writes always use `roles`.

A **role/portal switcher** appears in the header for multi-role users. It
navigates to the selected portal and stores the preference in a `portal` cookie.
The cookie is a UI convenience — authorization always checks the actual stored
`roles` array server-side.

Authentication and authorization are separate concerns.

Never trust a client-provided role.

Never rely on UI visibility for access control.

## Driver Role vs Eligibility

`roles` includes `"driver"` = user may access driver portal functionality.

`drivers/{uid}.eligibilityStatus == "eligible"` = government has authorized
that driver to claim deliveries.

These are independent. Do not combine them.

---

# Business Logic

Important operations must live outside UI components.

Create a clear domain/service layer for water request operations.

Examples:

```text
createWaterRequest
claimWaterRequest
markWaterDelivered
confirmWaterDelivery
disputeWaterDelivery
cancelWaterRequest
setDriverAvailability
restrictDriverAccess
restoreDriverAccess
```

These functions should be reusable later by non-web interfaces such as WhatsApp.

---

# Concurrency

Driver claiming must be atomic.

Use a Firestore transaction.

It must be impossible for two drivers to successfully claim the same request.

Treat this as a critical correctness requirement.

---

# UX Priorities

## Resident

Optimize for repeat use on a phone.

A returning resident should be able to request water with minimal effort.

Primary action:

**Request 1,000 Gallons**

Do not make users repeatedly enter information already saved in their profile.

## Driver

Optimize for phone use.

Primary driver workflow:

1. Go online.
2. View eligible requests.
3. Claim request.
4. View customer/location details.
5. Deliver water.
6. Mark delivered.

Do not build a complex driver dashboard.

## Dispatcher

Optimize for operational awareness.

A dispatcher should quickly see:

- New/open requests
- Preferred-driver holds
- Claimed requests
- Aging requests
- Delivered/unconfirmed requests
- Disputes
- Ineligible drivers

## Admin

Provide necessary system and driver management without turning V1 into a generic administration platform.

---

# Statistics

Statistics are not optional polish.

Preserve the underlying data necessary to calculate operational metrics from the beginning.

Do not sacrifice event history or timestamps for implementation convenience.

---

# Configuration

Business values likely to change should not be hard-coded throughout the application.

Examples:

```text
preferredDriverWindowHours
deliveryConfirmationWindowHours
```

Centralize configuration.

Initial preferred-driver window:

```text
24 hours
```

---

# WhatsApp

WhatsApp integration is planned.

Do **not** implement it during the initial web build.

However, avoid architecture that would require rewriting core business logic when WhatsApp is added.

WhatsApp should eventually invoke the same domain operations used by the web application.

---

# Payments

Payments are outside the initial application scope.

Do not add:

- Stripe
- Payment forms
- Driver balances
- Billing workflows
- Accounting integrations

Drivers currently collect payment from customers and separately pay government for water.

Government staff only need the ability to manually restrict/restore driver delivery access in V1.

---

# Photos

The system will support two categories of photos:

1. **Property photos** — uploaded by residents to help drivers locate the delivery point.
2. **Request photos** — uploaded by drivers as proof of delivery or to document issues.

## Key constraints

- Store image files in **Firebase Storage**, not Firestore. Firestore holds only metadata and a `storagePath` reference.
- Never expose permanent public download URLs for photos.
- Use short-lived signed URLs generated server-side when Storage Rules alone cannot enforce the required access check.
- Do not place personally descriptive data (names, addresses) in storage filenames. Use opaque identifiers.
- Enforce photo access at the storage layer. Hidden UI is not authorization.

## Access rules

- Residents: upload/view/update/delete their own property photos. May view request photos for their own deliveries.
- Drivers: view property photos only for residents whose delivery they hold. Upload request photos only for deliveries assigned to them.
- Dispatchers/admins: view photos as needed for operational support.

## Implementation notes

- Photo types and metadata interfaces are defined in `src/lib/domain/types.ts`.
- Firebase Storage rules are in `storage.rules` (deny-by-default scaffold).
- Firestore subcollection rules for photo metadata are in `firestore.rules`.
- The photo upload UI is **not required for V1**. Build it when explicitly requested.
- When implementing uploads, prefer server-side validation of file type and size before writing to Storage.

---

# Do Not Overbuild

Before introducing any of the following, verify that it is explicitly required:

- Background queues
- Complex event buses
- Microservices
- Route optimization
- AI features
- Native mobile apps
- Complex scheduling
- Generic workflow engines
- Elaborate notification frameworks
- Premature analytics infrastructure

This is an island-scale operational system.

Reliability and simplicity matter more than theoretical scale.

---

# Implementation Sequence

Unless the existing repository creates a strong reason otherwise, work approximately in this order:

1. Project foundation and Firebase configuration
2. Authentication
3. Roles and authorization
4. Firestore schema and security rules
5. Resident profile
6. Resident water request workflow
7. Driver availability
8. Driver request queue
9. Atomic claiming
10. Driver active-delivery workflow
11. Delivery confirmation
12. Dispatcher dashboard
13. Driver delivery access management
14. Property photo uploads (resident)
15. Proof-of-delivery photo uploads (driver)
16. Statistics dashboard
17. UI refinement and testing

Do not jump ahead into WhatsApp or payments.

---

# Admin Portal

The `/admin` portal provides user and role management. Only users with the
`admin` role may access it.

## Features

- User list with search/filter by name, email, or role
- User detail view with profile info, role management, and history
- Add/remove operational roles (driver, dispatcher, admin)
- Driver eligibility management (restrict/restore delivery access)
- Role-change audit trail (`users/{uid}/roleEvents` subcollection)

## Key behaviors

- `resident` is the baseline role and cannot be removed.
- Adding `driver` role creates a `drivers/{uid}` document (ineligible/offline).
- Removing `driver` role forces driver offline but preserves history.
- Admin cannot remove their own `admin` role (self-lockout protection).
- The last system admin cannot be removed (system lockout protection).
- All role mutations happen server-side via Admin SDK.
- Driver role removal is BLOCKED when active claimed deliveries exist.
  The admin must resolve/reassign deliveries through the dispatcher workflow first.

## Domain logic

- `src/lib/domain/admin.ts` — user listing, role add/remove, audit queries
- `src/app/admin/actions.ts` — server actions with admin authorization
- `src/app/admin/users/[uid]/` — user detail page and role management UI

---

# Statistics Dashboard

The `/statistics` page provides operational metrics for dispatcher and admin
staff. Accessible via "View Statistics" links in both portals.

## Access

- `dispatcher` and `admin` roles only (enforced server-side).

## Period filters

- Last 7 days, Last 30 days, This month, This year, All time.
- Default: Last 30 days.

## Metric sections

- **Summary cards:** Total requests, confirmed, unconfirmed, disputed, cancelled, gallons.
- **Current operations:** Open requests, aging (>24h, >48h), unresolved disputes, oldest.
- **Average times:** Request→Claim, Request→Delivery, Claim→Delivery, Delivery→Confirm.
- **Request volume:** Bar chart (daily for short periods, monthly for year/all).
- **Village demand:** Table sorted by highest demand, uses request village snapshot.
- **Driver operations:** Table with loads/deliveries/times/status per driver.
- **Preferred driver:** Usage rate, claimed by preferred, expired to queue, comparative timing.
- **Disputes:** Total, unresolved, resolved breakdown, dispute rate.

## Key methodology

- Gallons delivered = count of requests reaching delivered status × 1,000.
- Driver attribution uses current `assignedDriverId` (reflects final delivering driver).
- Dispute rate = disputes created / requests reaching delivered status.
- Preferred-driver expiration detected from `preferred_driver_expired` events.
- A single request counts as ONE customer request even if reopened after dispute.
- Missing timestamps are excluded from averages (not treated as zero).
- All calculations happen server-side from Firestore source collections.
- No parallel analytics database or ETL.

## Domain logic

- `src/lib/domain/statistics.ts` — all aggregation logic
- `src/app/statistics/` — page and UI components

---

# Before Major Changes

Before making a significant architectural decision:

1. Check `PRODUCT.md`.
2. Check `TECHNICAL.md`.
3. Determine whether the decision is already specified.
4. Prefer the simplest approach satisfying the documented requirement.
5. If an important product decision remains ambiguous, flag it rather than inventing complicated behavior.

---

# Definition of Done for Initial Web MVP

The MVP is successful when:

- A resident can authenticate.
- A resident can save delivery information.
- A resident can request one 1,000-gallon water delivery.
- Preferred-driver logic works.
- An eligible driver can go online and see appropriate requests.
- A driver can atomically claim a request.
- A driver can mark the delivery complete.
- A resident can confirm or dispute delivery.
- Government staff can see and manage the complete queue.
- Government staff can restrict/restore driver delivery access.
- Important state changes are auditable.
- Operational statistics are available.
- Permissions are enforced beyond the UI.
- The application works well on mobile devices.
- Core business logic is reusable for the future WhatsApp interface.