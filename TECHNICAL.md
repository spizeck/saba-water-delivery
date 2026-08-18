# Water Delivery System Technical Guide

## Architecture

Initial application stack:

- Next.js App Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Storage (for property and delivery photos)
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

A single user may hold **multiple roles** simultaneously. The canonical field is:

```ts
roles: Array<"resident" | "driver" | "dispatcher" | "admin">
```

New users default to `roles: ["resident"]`. Roles are only granted through
trusted server-side (Admin SDK) operations — never by client writes.

**Backward compatibility:** Existing Firestore user documents may still contain
a singular `role` field. The server-side `toUserProfile()` function handles both
formats transparently (reading `roles` if present, otherwise wrapping the
singular `role` into an array). New documents are always written with the
`roles` array.

Role checks must be enforced server-side and/or through Firestore Security Rules as appropriate.

Do not trust role values submitted by clients.

## Role vs Eligibility (Drivers)

Having the `driver` role grants access to driver portal functionality. Whether a
driver may actually claim deliveries is controlled separately by
`drivers/{uid}.eligibilityStatus`. These are independent concepts and must not
be conflated.

---

# Suggested Firestore Model

This is a starting model, not an instruction to blindly reproduce every field.

## users/{uid}

```ts
{
  displayName: string
  email: string | null
  phone: string | null
  roles: Array<"resident" | "driver" | "dispatcher" | "admin">

  village: string | null
  deliveryDirections: string | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

> **Migration note:** Legacy documents may have a singular `role` field instead
> of `roles`. The application reads both formats safely. New documents and
> profile updates always write `roles`.

## users/{uid}/roleEvents/{eventId}

```ts
{
  type: "role_added" | "role_removed"
  role: "driver" | "dispatcher" | "admin"
  actorId: string        // uid of the admin who made the change
  createdAt: Timestamp
}
```

Role changes are recorded here for audit. These are admin-only operations.

## drivers/{uid}

```ts
{
  userId: string

  eligibilityStatus: "eligible" | "ineligible"
  availabilityStatus: "online" | "offline"

  ineligibilityReason: string | null
  restrictedAt: Timestamp | null
  restrictedBy: string | null

  // Dispatch-offer decline cooldown. Set when a driver reaches the
  // configured daily decline limit; cleared naturally once it passes.
  // This is independent of eligibilityStatus and availabilityStatus —
  // see "Dispatch Offers" below.
  cooldownUntil: Timestamp | null

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

## users/{uid}/propertyPhotos/{photoId}

```ts
{
  type: "house" | "cistern" | "access" | "other"
  storagePath: string       // Firebase Storage path (not a public URL)
  uploadedBy: string        // uid of uploader (should match parent uid)
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

Property photos help drivers locate the delivery point. Metadata lives in
Firestore; actual image bytes live in Firebase Storage at the referenced
`storagePath`. See "Firebase Storage" below.

## waterRequests/{requestId}/photos/{photoId}

```ts
{
  type: "proof_of_delivery" | "delivery_issue" | "access_issue" | "other"
  storagePath: string       // Firebase Storage path (not a public URL)
  uploadedBy: string        // uid of uploader (assigned driver)
  createdAt: Timestamp
}
```

Request photos document the delivery. Only the assigned driver may upload
photos for a request. Multiple photos per request are supported.

## driverOffers/{offerId}

```ts
{
  requestId: string
  driverId: string

  offeredAt: Timestamp
  response: "accepted" | "declined" | "expired" | null
  respondedAt: Timestamp | null
}
```

Records one instance of a single request being offered to a single
driver as part of the one-request-at-a-time dispatch workflow (see
"Dispatch Offers" below). Documents are append-only — a decline or
expiration is never overwritten, so full offer history is preserved for
auditing and statistics.

`response: null` means the offer is still pending. `"expired"` means the
offer was superseded before the driver responded (e.g. another driver
claimed the request first, or it was cancelled/reassigned).

## config/dispatchSettings

```ts
{
  maxDeclinesPerDay: number
  declineCooldownHours: number
  updatedAt: Timestamp
  updatedBy: string   // uid of the admin who last saved these values
}
```

Admin-editable dispatch settings (see "Dispatch Offers" below). If this
document does not exist yet, the application falls back to
`appConfig.defaultMaxDeclinesPerDay` / `defaultDeclineCooldownHours`
(`src/lib/domain/config.ts`) without writing anything — the document is
only created the first time an admin saves settings.

## config/dispatchSettings/events/{eventId}

```ts
{
  type: "dispatch_settings_updated"
  actorId: string
  createdAt: Timestamp
  oldValues: { maxDeclinesPerDay: number; declineCooldownHours: number }
  newValues: { maxDeclinesPerDay: number; declineCooldownHours: number }
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
preferred_driver_declined
request_opened
driver_claimed
driver_reassigned
marked_delivered
customer_confirmed
customer_disputed
request_cancelled
```

Driver events (`drivers/{uid}/events/{eventId}`) additionally include
`driver_cooldown_started`, recorded when a driver reaches the daily
decline limit (see "Dispatch Offers" below).

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

`claimWaterRequest()` remains the single source of atomic-claim
correctness. The dispatch offer workflow below is a UI/bookkeeping layer
built on top of it, not a replacement for it — an offer never reserves a
request, so `claimWaterRequest()` must still validate live request state
at accept time.

---

# Dispatch Offers

Drivers do not browse a list of open requests. Instead, an eligible,
online driver is shown at most one claimable offer at a time
(`src/lib/domain/dispatch.ts`, `getNextOfferForDriver()`). This reduces
cherry-picking (see PRODUCT.md "Dispatch Offers").

## Selection algorithm

1. If the driver has a pending (unanswered) offer whose underlying
   request is still valid to offer to them, reuse it — reloading the
   driver portal must not manufacture a new offer while one is pending.
   Otherwise mark the stale offer `"expired"`.
2. Otherwise, opportunistically expire any preferred-driver holds whose
   window has passed (mirrors the previous lazy-expiration behavior, so
   the general queue stays healthy without a scheduled job).
3. Select a candidate:
   - A `preferred_driver_hold` addressed to this driver, if not expired.
   - Otherwise, the oldest `available` request this driver has not
     already declined (`getDeclinedRequestIdsForDriver()`), preserving
     fairness by request age.
4. Create a `driverOffers` document for the candidate and return it.

## Accept / decline

- **Accept** (`acceptDriverOffer()`) delegates to `claimWaterRequest()`.
  On success the offer is recorded `"accepted"`. On failure (someone else
  claimed it first, hold expired, etc.) the offer is recorded `"expired"`
  — not `"declined"` — since this was not the driver's choice, and the
  original error propagates to the caller.
- **Decline** (`declineDriverOffer()`) records `"declined"` and does
  **not** claim the request; it remains available at its original
  `requestedAt` for another driver. If the declined offer was a
  preferred-driver hold addressed to this driver, the hold ends
  immediately (transitions to `available`, preserving `requestedAt`) and
  a `preferred_driver_declined` event is recorded, rather than waiting
  for the hold window to expire.

## Decline limit and cooldown

After recording a decline, `declineDriverOffer()` checks the driver's
decline count for the current local day
(`countDeclinesToday()`) against the admin-configurable
`config/dispatchSettings.maxDeclinesPerDay` (default 3). If the driver has
reached the limit, `startDriverCooldown()` sets
`drivers/{uid}.cooldownUntil` to `now + declineCooldownHours` (default 1
hour) and records a `driver_cooldown_started` driver event.

`cooldownUntil` is intentionally separate from `eligibilityStatus`
(government authorization) and `availabilityStatus` (the driver's own
online/offline preference) — see PRODUCT.md "Driver Availability" and
"Dispatch Offers". While in cooldown:

- The driver receives no new offers (`getNextOfferForDriver()` prerequisite,
  enforced by the caller in `src/app/driver/page.tsx`).
- `setDriverAvailability()` rejects a transition to `"online"` with
  `DRIVER_IN_COOLDOWN` — a driver cannot bypass the cooldown by toggling
  offline and back online, because enforcement compares `cooldownUntil`
  against server time, not client state.
- Existing claimed deliveries and `markWaterDelivered()` remain fully
  available.

### Local-day decline counting and timezone

"Per day" is defined using the local operational day for Saba, configured
as `appConfig.operationalTimezone` (`America/Kralendijk` — Caribbean
Netherlands, fixed UTC-4 with no daylight saving). `countDeclinesToday()`
bounds its Firestore query with a generous 26-hour lookback and then
filters precisely by comparing each decline's formatted local calendar
date (`Intl.DateTimeFormat` with `timeZone`) against today's local date.
This avoids having to compute an exact UTC instant for local midnight and
remains correct even if the timezone ever changes to one that observes
DST.

## Avoiding re-offer loops

`getDeclinedRequestIdsForDriver()` excludes requests a driver has already
declined from being selected as their next offer again, bounded to a
recent window of their own decline history — enough to prevent obvious
loops without an unbounded read.

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
restrictDriverAccess()
restoreDriverAccess()
expirePreferredDriverHold()
getNextOfferForDriver()
acceptDriverOffer()
declineDriverOffer()
startDriverCooldown()
getDispatchSettings()
updateDispatchSettings()
```

Future WhatsApp actions should call the same domain operations.

There should not be separate "web logic" and "WhatsApp logic."

---

# Firestore Security

Security Rules are part of the application architecture.

At minimum:

Residents should only access appropriate customer-facing data, primarily their own requests.

Drivers should only access data necessary for:

- Their currently offered request (dispatch offer), not a browsable list
  of all open requests
- Their claimed deliveries
- Their own driver profile/history and offer history

Dispatchers should have operational access.

Admins should have administrative access.

Privileged operations such as role changes, delivery access restrictions and forced reassignments should happen through trusted server-side code.

Design Firestore queries together with Security Rules.

Do not assume Security Rules will filter unauthorized documents out of an overly broad query.

---

# Firebase Storage

Image binary data must not be stored in Firestore. Use Firebase Storage for actual image files and Firestore only for photo metadata and storage paths.

## Storage Layout

```text
property-photos/{uid}/{photoId}
request-photos/{requestId}/{photoId}
```

Use opaque identifiers (document IDs) for filenames rather than names, addresses, or other personally descriptive data.

## Storage Security Rules

Firebase Storage Security Rules must enforce access independently of the UI. The starting posture is deny-by-default.

At minimum:

**Property photos (`property-photos/{uid}/`):**

- The owning resident may upload, read, update, and delete their own photos.
- Drivers may read a resident's property photos only when they hold a claimed/assigned delivery for that resident. This requires cross-referencing Firestore to verify the delivery relationship; if cross-referencing is impractical in Storage Rules alone, generate short-lived signed URLs server-side instead of granting broad read access.
- Dispatchers/admins may read property photos for operational support.
- No public access.

**Request photos (`request-photos/{requestId}/`):**

- Only the driver assigned to the request may upload photos for that request.
- The assigned driver, the customer who owns the request, and dispatchers/admins may read request photos.
- No public access.

**General principles:**

- Never expose permanent unrestricted download URLs.
- Prefer short-lived signed URLs generated server-side when the Storage Rules alone cannot express the required access check (e.g. verifying an active delivery relationship).
- Storage Rules are defined in `storage.rules` and referenced from `firebase.json`.

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
- Driver delivery access restricted
- Driver delivery access restored
- Property photo uploaded/updated/removed
- Request photo uploaded

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
- Automated billing-based driver access restriction

Build the underlying architecture so reasonable future additions remain possible without prematurely implementing them.