# Water Delivery System Technical Guide

## Architecture

Initial application stack:

- Next.js App Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Admin SDK for trusted server-side operations
- Vercel deployment
- Responsive web interface

Firestore is the application's source of truth.

Future integrations, including WhatsApp, must operate against the same domain logic and Firestore data.

---

# Authentication

Use Firebase Authentication.

Initial providers:

- Google
- Facebook
- Email/password

Authentication identifies the user.

Authorization must be controlled separately using application roles and Firestore Security Rules.

Never treat a hidden UI element as authorization.

---

# Roles

Initial roles:

```text
resident
driver
dispatcher
admin
```

Role checks must be enforced server-side and/or through Firestore Security Rules as appropriate.

Do not trust role values submitted by clients.

---

# Suggested Firestore Model

This is a starting model, not an instruction to blindly reproduce every field.

## users/{uid}

```ts
{
  displayName: string
  email: string | null
  phone: string | null
  role: "resident" | "driver" | "dispatcher" | "admin"

  village: string | null
  deliveryDirections: string | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## drivers/{uid}

```ts
{
  userId: string

  authorizationStatus: "active" | "suspended"
  availabilityStatus: "online" | "offline"

  suspensionReason: string | null
  suspendedAt: Timestamp | null
  suspendedBy: string | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## waterRequests/{requestId}

```ts
{
  customerId: string

  gallons: 1000

  village: string
  deliveryDirections: string

  preferredDriverId: string | null
  preferredDriverExpiresAt: Timestamp | null

  assignedDriverId: string | null

  status:
    | "requested"
    | "preferred_driver_hold"
    | "available"
    | "claimed"
    | "delivered"
    | "confirmed"
    | "delivered_unconfirmed"
    | "disputed"
    | "cancelled"

  requestedAt: Timestamp
  availableAt: Timestamp | null
  claimedAt: Timestamp | null
  deliveredAt: Timestamp | null
  confirmedAt: Timestamp | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

## waterRequests/{requestId}/events/{eventId}

```ts
{
  type: string
  actorId: string | null
  actorRole: string | null
  createdAt: Timestamp
  metadata: Record<string, unknown> | null
}
```

Examples:

```text
request_created
preferred_driver_selected
preferred_driver_expired
request_opened
driver_claimed
driver_reassigned
marked_delivered
customer_confirmed
customer_disputed
request_cancelled
```

Preserve events for auditing and statistics.

---

# Request Claiming

Claiming a delivery is concurrency-sensitive.

Never implement this as:

1. Read request.
2. Check `assignedDriverId`.
3. Write driver ID.

Use a Firestore transaction.

The transaction must verify:

- Request is currently claimable.
- Request has no assigned driver.
- Driver is authorized.
- Driver is eligible for the request.
- Preferred-driver restrictions, if active, are satisfied.

Then atomically:

- Set `assignedDriverId`.
- Set status to `claimed`.
- Set `claimedAt`.
- Record necessary assignment information.

Only one concurrent driver may succeed.

---

# Preferred Driver Expiration

The preferred-driver window must be configurable.

Initial setting:

```text
preferredDriverWindowHours = 24
```

Do not scatter this value through application code.

Store application configuration centrally.

Expiration logic must eventually allow an unclaimed preferred request to transition automatically to `available`.

Implementation details may evolve, but business logic should be isolated from UI components so future scheduled jobs or server processes can invoke the same transition.

---

# Domain Logic

Do not bury important business logic directly inside React components.

Create reusable server-side domain functions for operations such as:

```text
createWaterRequest()
claimWaterRequest()
markWaterDelivered()
confirmWaterDelivery()
disputeWaterDelivery()
cancelWaterRequest()
setDriverAvailability()
suspendDriver()
reactivateDriver()
expirePreferredDriverHold()
```

Future WhatsApp actions should call the same domain operations.

There should not be separate "web logic" and "WhatsApp logic."

---

# Firestore Security

Security Rules are part of the application architecture.

At minimum:

Residents should only access appropriate customer-facing data, primarily their own requests.

Drivers should only access data necessary for:

- Eligible available requests
- Their claimed deliveries
- Their own driver profile/history

Dispatchers should have operational access.

Admins should have administrative access.

Privileged operations such as role changes, suspensions and forced reassignments should happen through trusted server-side code.

Design Firestore queries together with Security Rules.

Do not assume Security Rules will filter unauthorized documents out of an overly broad query.

---

# Server vs Client

Prefer server-side data access and mutations where practical.

Client components should be used when browser interactivity requires them.

Sensitive administrative operations should use trusted server-side Firebase Admin SDK code.

Never expose Firebase Admin credentials to the browser.

Firebase client configuration may be public as intended by Firebase, with actual authorization enforced through authentication and security rules.

---

# Auditability

Important state changes should generate events.

At minimum audit:

- Request creation
- Preferred-driver selection/expiration
- Driver claim
- Manual assignment/reassignment
- Delivery marking
- Customer confirmation
- Customer dispute
- Cancellation
- Driver suspension
- Driver reactivation

For administrative actions, record the responsible user.

Avoid destructive history changes where an event record is more appropriate.

---

# Statistics

Statistics should be derived from reliable request and event data.

Do not prematurely maintain many duplicated counters in V1 unless performance requires them.

Store timestamps required to calculate:

```text
request → available
request → claimed
request → delivered
delivery → confirmed
```

Use completed request count to calculate gallons:

```text
completedRequests * 1000
```

Design indexes intentionally as query patterns become clear.

---

# Future WhatsApp Integration

WhatsApp is expected to become an important interface.

Architect V1 so WhatsApp can later trigger the same server-side operations as the web interface.

Potential commands/actions include:

```text
ON
OFF
NEXT
ACCEPT
SKIP
MY JOBS
DELIVERED
HELP
```

Do not implement these during initial web development unless explicitly requested.

Do not store authoritative application state inside WhatsApp conversations.

---

# Out of Scope for Initial Build

Do not implement:

- Online payments
- Driver accounting
- QuickBooks integration
- Route optimization
- Complex scheduling
- Delivery time slots
- Multiple water quantities
- Native mobile apps
- WhatsApp integration
- Automated billing-based driver suspension

Build the underlying architecture so reasonable future additions remain possible without prematurely implementing them.