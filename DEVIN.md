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

Authentication and authorization are separate concerns.

Never trust a client-provided role.

Never rely on UI visibility for access control.

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
14. Statistics dashboard
15. UI refinement and testing

Do not jump ahead into WhatsApp or payments.

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