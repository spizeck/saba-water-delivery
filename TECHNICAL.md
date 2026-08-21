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
viewer
```

A single user may hold **multiple roles** simultaneously. The canonical field is:

```ts
roles: Array<"resident" | "driver" | "dispatcher" | "admin" | "viewer">
```

`viewer` is read-only oversight — see "Viewer Role" below. It is
deliberately excluded from `hasStaffAccess()` (`src/lib/auth/roles.ts`);
any mutating server action must keep requiring `dispatcher`/`admin`
explicitly.

New users default to `roles: ["resident"]`. Roles are only granted through
trusted server-side (Admin SDK) operations — never by client writes.

Role checks must be enforced server-side and/or through Firestore Security Rules as appropriate.

Do not trust role values submitted by clients.

## Role vs Eligibility (Drivers)

Having the `driver` role grants access to driver portal functionality. Whether a
driver may actually claim deliveries is controlled separately by
`driverRegistry/{driverId}.eligibilityStatus`. These are independent concepts
and must not be conflated.

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

  // When the resident last affirmatively reviewed phone/village/
  // deliveryDirections and confirmed it was still correct — either by
  // clicking "Everything Is Correct" on the delivery-profile reminder,
  // or by saving a change to one of those fields. Distinct from
  // `updatedAt` (which changes on ANY profile save). Missing on
  // historical documents that predate this field; treated as null
  // (never confirmed) rather than backfilled. See "Delivery Profile
  // Confirmation Reminder" below.
  deliveryProfileConfirmedAt: Timestamp | null

  createdAt: Timestamp
  updatedAt: Timestamp
}
```

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

## driverRegistry/{driverId}

```ts
{
  displayName: string
  phone: string | null

  // Firebase uid of the linked application account, or null if unlinked.
  linkedUserId: string | null

  eligibilityStatus: "eligible" | "ineligible"
  availabilityStatus: "online" | "offline"

  ineligibilityReason: string | null
  restrictedAt: Timestamp | null
  restrictedBy: string | null

  cooldownUntil: Timestamp | null

  // Operational lock for the one-active-delivery invariant. Set to the
  // currently claimed waterRequest ID; null when the driver has no
  // active delivery. Updated atomically inside the same Firestore
  // transactions that assign or complete a delivery.
  activeRequestId: string | null

  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy: string
}
```

A driver is a government-managed entity — see PRODUCT.md "Driver
Registry." `driverId` (this document's ID) is an auto-generated
Firestore ID, independent of any user account, so a driver can be
entered before they ever sign in. See "Canonical Driver ID" below for
why this ID is never itself stored on a water request.

### driverRegistry/{driverId}/events/{eventId}

Same shape as `waterRequests/{id}/events` (`type`, `actorId`,
`actorRole`, `createdAt`, `metadata`). Event types include the existing
`driver_online` / `driver_offline` / `driver_access_restricted` /
`driver_access_restored` / `driver_cooldown_started`, plus:

```text
driver_registry_created
driver_registry_updated
driver_account_linked
driver_account_unlinked
meter_assignment_added
meter_assignment_updated
meter_assignment_removed
```

### driverRegistry/{driverId}/meters/{stationId}

```ts
{
  meterCode: string
  meterNumber: number
  updatedAt: Timestamp
  updatedBy: string
}
```

One document per fill station the driver has a meter assignment at.
Document ID is the `fillStations` station ID, so each station's
assignment can be edited independently.

## fillStations/{stationId}

```ts
{
  name: string
  active: boolean
}
```

Stable IDs: `bottom`, `wws`, `hells-gate`. `ensureDefaultFillStations()`
(`src/lib/domain/fillStations.ts`) idempotently provisions these three
on read if missing — safe to call repeatedly, since it never overwrites
an existing document and contains no customer/driver data. New stations
can be added later; inactive stations are excluded from driver-facing
meter editing but not deleted.

## Canonical Driver ID

Two different "driver IDs" exist in this system, and the distinction is
deliberate:

- **`driverRegistry` document ID** — identifies the driver as a
  government entity, for admin/meter/eligibility management. Never
  stored on a water request or offer.
- **Firebase uid of the linked account** — identifies the driver as an
  authenticated actor. This is what `waterRequests.assignedDriverId`,
  `waterRequests.preferredDriverId`, and `driverOffers.driverId` store,
  unchanged from before the registry existed.

Rationale: every operational action (receiving an offer, accepting,
declining, claiming, marking delivered) inherently requires an
authenticated session, so the uid is the only identifier available at
that point anyway. Introducing the registry ID as a second, competing
identifier for the same operational fields would require a lookup table
and risk requests silently referencing two different "kinds" of driver
ID over time. Instead, `driverRegistry.linkedUserId` is the single
bridge: operational code (`claimWaterRequest`, `dispatcherAssign`,
`dispatcherReassign`, `getEligibleDriverOptions`, dispatch cooldown/
availability) looks up a driver's registry entry by `linkedUserId`
rather than by registry ID.

A practical consequence: **only linked, eligible drivers can appear in
any picker or be assigned to a request** — an unlinked driver can be
marked eligible in the registry (e.g. in anticipation of them signing
up), but cannot yet be selected anywhere that ultimately needs a uid.

This is a one-time architectural decision made now, before production
data accumulates, specifically so future requests don't end up
referencing driver IDs inconsistently.

## waterRequests/{requestId}

```ts
{
  // null for an unregistered/manual customer (see "Dispatcher-Created
  // Requests" below). Never trust this alone for identity — prefer
  // `customer` for display.
  customerId: string | null

  // Snapshot of the customer's identity at creation time. Present on
  // every new request (registered or not); null only on historical
  // documents that predate this field.
  customer: {
    displayName: string
    phone: string | null
    email: string | null
    isRegistered: boolean
  } | null

  // Where the request originated. Historical documents without this
  // field are treated as "resident" (all pre-existing requests were).
  source: "resident" | "dispatcher"

  // uid of the dispatcher/admin who created this request. Always null
  // when source is "resident".
  createdBy: string | null

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
    | "disputed"
    | "cancelled"

  // Snapshot of the resident's reported water situation at request
  // time (see PRODUCT.md "Additional Water Request Information").
  // Never re-derived from a later profile lookup — see "Historical
  // Snapshot" below. Null only on historical documents that predate
  // this field.
  waterSituation: {
    personsAffected: number | null
    vulnerableCircumstances: Array<
      | "elderly"
      | "infant_or_young_child"
      | "medical_need"
      | "essential_services_commercial_business"
      | "hotel_or_restaurant"
      | "none"
    >
    availableStorageCapacity: string | null
    // Resident-facing choice is deliberately just Normal/Critical — see
    // PRODUCT.md "Resident-Reported Urgency". Distinct from
    // `dispatchPriority` below, which still supports "urgent".
    reportedUrgency: "normal" | "critical"
    // Required (non-blank, trimmed) when reportedUrgency === "critical";
    // always null when reportedUrgency === "normal" — see
    // `buildWaterSituationSnapshot()` in `waterSituation.ts`.
    criticalExplanation: string | null
  } | null

  // Attestation captured before request creation.
  attestationAccepted: boolean | null
  attestationAcceptedAt: Timestamp | null

  // Operational dispatch priority — see "Priority-Based Dispatch"
  // below. Historical documents predate this field and default to
  // "normal" (see `toWaterRequest()`).
  dispatchPriority: "normal" | "urgent" | "critical"
  // Denormalized numeric mirror of `dispatchPriority`, used ONLY to
  // sort Firestore queries (critical=0, urgent=1, normal=2) because the
  // string values do not alphabetize into the intended order. Always
  // kept in sync with `dispatchPriority` — see `priorityRankFor()` in
  // src/lib/domain/priority.ts. Never read directly by application
  // code outside of query construction.
  priorityRank: number
  prioritySource: "system" | "dispatcher"
  priorityReason: string | null
  priorityUpdatedBy: string | null
  priorityUpdatedAt: Timestamp | null

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
request_created_by_dispatcher
preferred_driver_selected
preferred_driver_expired
preferred_driver_declined
request_opened
driver_claimed
driver_reassigned
marked_delivered
customer_confirmed
delivery_confirmed_by_dispatcher
customer_disputed
delivery_auto_confirmed
request_cancelled
request_priority_changed
preferred_driver_bypassed_for_priority
preferred_driver_hold_released_for_priority
```

`request_created_by_dispatcher` and `delivery_confirmed_by_dispatcher`
are deliberately distinct from their resident-initiated equivalents —
never disguise a staff-initiated action as the customer's own (see
"Dispatcher-Created Requests" below).

Driver events (`driverRegistry/{driverId}/events/{eventId}`) additionally
include `driver_cooldown_started`, recorded when a driver reaches the daily
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
- Driver does not already have a different active claimed delivery.
- Preferred-driver restrictions, if active, are satisfied.

Then atomically:

- Set `assignedDriverId`.
- Set status to `claimed`.
- Set `claimedAt`.
- Set `driverRegistry.activeRequestId` to this request ID.
- Record necessary assignment information.

Only one concurrent driver may succeed.

A query inside the request transaction is not enough to prevent two
concurrent claims by the same driver (Firestore queries do not guarantee
absence of phantoms). Therefore the driver registry maintains an
`activeRequestId` field that is read and written in the same transaction as
the claim. This single-document lock serializes all assignment and release
operations for a driver.

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

1. If the driver already has a request in `claimed` status, return no
   offer. They are online but temporarily unavailable for a second
   delivery until the current one is marked delivered.
2. If the driver has a pending (unanswered) offer whose underlying
   request is still valid to offer to them, reuse it — reloading the
   driver portal must not manufacture a new offer while one is pending.
   Otherwise mark the stale offer `"expired"`.
3. Opportunistically expire any preferred-driver holds whose window has
   passed (mirrors the previous lazy-expiration behavior, so the general
   queue stays healthy without a scheduled job).
4. Select a candidate:
   - A `preferred_driver_hold` addressed to this driver, if not expired.
   - Otherwise, the oldest `available` request this driver has not
     already declined (`getDeclinedRequestIdsForDriver()`), preserving
     fairness by request age.
5. Create a `driverOffers` document for the candidate and return it.

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
`driverRegistry/{driverId}.cooldownUntil` to `now + declineCooldownHours` (default 1
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

# Priority-Based Dispatch

See PRODUCT.md "Water Situation & Request Priority" / "Preferred
Driver" for the product rationale. This section is the implementation
reference for "why was this request offered before that one."

## Initial priority

`determineInitialDispatchPriority()` (`src/lib/domain/priority.ts`) is
the single, documented, deterministic function that maps a
`WaterSituationSnapshot` to an initial `dispatchPriority`. It is a short
decision tree, not a scoring model — see the function's doc comment for
the exact rule order. `createWaterRequest()` calls it once, at creation
time, and stores the result plus the human-readable `priorityReason`
directly on the request.

Current rule (see PRODUCT.md "Resident-Reported Urgency" / "Dispatch
priority is not the same as reported urgency" for the product
rationale):

1. **Critical** — any vulnerable/critical circumstance is selected
   (elderly, infant/young child, medical need, essential services
   (commercial/business), or hotel/restaurant), **or**
2. **Critical** — the resident self-reports "Critical" urgency. This is
   only reachable with the required, non-blank `criticalExplanation`
   (validated in `buildWaterSituationSnapshot()`,
   `src/lib/domain/waterSituation.ts`, throwing
   `CRITICAL_EXPLANATION_REQUIRED` otherwise) — a resident can no longer
   reach an initial Critical priority with a bare, unexplained click.
3. **Normal** — everything else.

`"urgent"` is never assigned by this function — it remains a fully
valid `DispatchPriority` that only a dispatcher/admin override
(`changeRequestPriority()`) can set. This is a deliberate simplification
from the previous rule, which capped a bare "Critical" self-report at
Urgent pending staff review; that cap is no longer needed now that every
Critical self-report carries a specific, staff-reviewable written
explanation.

## Priority ranking for Firestore ordering

`dispatchPriority` is a string (`"normal" | "urgent" | "critical"`), but
alphabetical order of those strings does not match the intended
critical-first ordering. Every request also stores a denormalized
numeric `priorityRank` (`priorityRankFor()` in `priority.ts`: critical =
0, urgent = 1, normal = 2), kept in sync everywhere `dispatchPriority` is
written (`createWaterRequest()`, `changeRequestPriority()`). All
priority-aware Firestore queries `orderBy("priorityRank", "asc")` first,
then `orderBy("requestedAt", "asc")` — see `firestore.indexes.json` for
the composite indexes this requires.

## Dispatch offer selection

`getNextOfferForDriver()` (`src/lib/domain/dispatch.ts`) selects, in
order:

1. A `preferred_driver_hold` addressed to this driver, not yet expired
   (ordered by `priorityRank` then `requestedAt` in case more than one
   is ever addressed to the same driver — practically always at most
   one).
2. Otherwise, the oldest `available` request this driver has not
   already declined, ordered by `priorityRank` then `requestedAt` —
   i.e. highest priority first, oldest first within a priority level.

This preserves the existing decline/cooldown and atomic-claim guarantees
unchanged — priority only changes WHICH request is selected, never how
selection or claiming works mechanically.

## Preferred driver vs. priority

A preferred driver is a resident preference, never a guaranteed
assignment (see PRODUCT.md). `isDriverImmediatelyAvailable()`
(`src/lib/domain/driverRegistry.ts`) answers "could this driver claim a
request right now" (linked, eligible, online, not in cooldown) and is
the single check used everywhere this distinction matters:

- **`createWaterRequest()`**: for a Normal-priority request with a
  preferred driver, a `preferred_driver_hold` is always created
  (exclusive window), even if the driver is currently offline. For an
  Urgent/Critical request, the hold is only created if
  `isDriverImmediatelyAvailable()` is true; otherwise the request skips
  the hold entirely and starts `"available"` immediately, with a
  `preferred_driver_bypassed_for_priority` event recorded (the
  preference itself, `preferredDriverId`, is still stored for
  display/statistics — it just never blocked dispatch).
- **`changeRequestPriority()`**: when a dispatcher/admin escalates an
  existing `preferred_driver_hold` to Urgent/Critical,
  `reevaluatePreferredDriverHoldForPriority()` re-checks the same
  availability condition immediately. If the driver is available, the
  hold is left alone (not delaying anything). If not,
  `preferred_driver_hold_released_for_priority` transitions the request
  straight to `"available"`, preserving `requestedAt`.
- **Decline** (existing behavior, unchanged): `declineDriverOffer()`
  still ends a hold immediately regardless of priority — an active
  decline is always decisive.

## Dispatcher priority override

`changeRequestPriority()` (`src/lib/domain/waterRequests.ts`) is the
only way to change `dispatchPriority` after creation. It:

- Requires a non-empty `reason` (`PRIORITY_REASON_REQUIRED` otherwise).
- Sets `prioritySource: "dispatcher"`, `priorityReason`,
  `priorityUpdatedBy`, `priorityUpdatedAt`.
- Records a `request_priority_changed` event with the previous and new
  priority, reason, and actor.
- Re-evaluates an active preferred-driver hold as described above.
- Never modifies the resident's original `waterSituation` snapshot.

`src/app/dispatcher/actions.ts` `changePriority()` is the server action
behind the "Change priority" panel on `/dispatcher/[requestId]`
(`RequestActions.tsx`), staff-only (`requireRole(["dispatcher",
"admin"])`).

## Privacy

Drivers only ever see the priority LEVEL (e.g. an "Urgent
delivery"/"Critical delivery" badge in `OfferCard.tsx` /
`ClaimedDeliveries.tsx`), never the underlying `waterSituation` detail —
see PRODUCT.md "Water Situation Privacy". `/viewer` includes
`dispatchPriority` in its reduced projection (operational, not
sensitive) but not `waterSituation`. Dispatcher/admin see the full
water situation on `/dispatcher/[requestId]`.

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

# Dispatcher-Created Requests

Dispatcher/admin staff can create a water request on behalf of a
customer who called or visited the office (`/dispatcher/new`). Both the
resident portal and this staff flow call the **same**
`createWaterRequest()` — there is no separate manual queue or duplicated
business logic (see PRODUCT.md "Dispatcher-Created Requests").

## Registered vs unregistered

- **Registered resident**: `customerId` is their uid. The dispatcher
  selects them from `getResidentDirectory()` (`src/lib/domain/users.ts`),
  a lightweight staff-facing directory distinct from the full admin user
  list. `createWaterRequest()` still enforces the hard one-active-request
  rule via the same transactional check used for resident-submitted
  requests — the caller (`src/app/dispatcher/actions.ts`,
  `createManualRequest`) surfaces the resident's existing active request
  on conflict rather than a generic error.
- **Unregistered/manual customer**: `customerId` is `null`. No Firebase
  Auth account is created. `createWaterRequest()` requires a `customer`
  snapshot (`displayName` + `phone`; `email` optional) and skips the
  customerId-based duplicate transaction (checking by `customerId` would
  be meaningless — every unregistered request shares `customerId ===
  null`).

## Customer snapshot

Every new request stores a `customer` snapshot
(`WaterRequestCustomerSnapshot`) at creation time:

```ts
{ displayName: string; phone: string | null; email: string | null; isRegistered: boolean }
```

For a registered resident, `createWaterRequest()` builds this
automatically from their saved profile if the caller doesn't supply one
— so resident-submitted requests get the same consistent snapshot
structure as dispatcher-created ones, for stable historical display
regardless of later profile edits. UI code should prefer `request.customer`
over a live profile lookup.

## Duplicate detection

- Registered resident: hard block via the existing transactional
  one-active-request check (`DUPLICATE_ACTIVE_REQUEST`).
- Unregistered customer: soft warning only.
  `findActiveRequestsByPhone()` looks for unresolved requests with a
  matching `customer.phone`. Phone matching is not identity verification
  (shared household phones, typos, reused numbers), so a match blocks
  nothing by itself — the dispatcher action returns a
  `"duplicate_warning"` state with the matching request(s), and staff can
  explicitly acknowledge and proceed. Proceeding is recorded on the
  creation audit event as `overrodeDuplicateWarningFor: [requestId, ...]`
  — never silent.
- `getActiveCustomerIds()` lets the create-request UI flag registered
  residents who already have an active request directly in the search
  results, before the dispatcher even attempts to submit.

## Same dispatch workflow

A dispatcher-created request is a normal `waterRequests` document like
any other — preferred-driver hold/decline, oldest-first offer selection,
one-offer-at-a-time driver dispatch, atomic claiming, delivery, dispute,
reassignment, cancellation, and statistics all operate on it identically.
No driver-facing code branches on `source`.

## Staff confirmation for unregistered customers

`confirmDeliveryByStaff()` lets dispatcher/admin staff close out a
`delivered` request on behalf of an unregistered customer, who has no
authenticated portal to confirm through themselves.
It is scoped to `customerId === null` requests only — it throws
`REQUEST_HAS_REGISTERED_CUSTOMER` if called against a registered
resident's request, which must go through their own
`confirmWaterDelivery()` / `disputeWaterDelivery()` (or the existing
dispute-resolution tools) instead. It records
`delivery_confirmed_by_dispatcher`, never `customer_confirmed`, so the
audit trail never misrepresents a staff action as the customer's own.
Both accept only `status === "delivered"` — there is no separate
"unconfirmed" status to also accept (see "Delivery Confirmation
Timeout" below).

## Future account linking

Not implemented. An unregistered customer's historical requests could
later be associated with a registered account, but this must be a
deliberate, staff-initiated, auditable action — never an automatic
background match by name alone. Do not build this until explicitly
requested.

---

# Delivery Confirmation Timeout

See PRODUCT.md "Delivery Confirmation" for the product rules. This
section is the implementation reference.

## One active delivery vs. customer confirmation

These are deliberately independent concerns:

- **One active delivery per driver** — a driver's operational
  responsibility for dispatch purposes ends the moment they mark a
  request `delivered`. `markWaterDelivered()` clears
  `driverRegistry.activeRequestId` in the same transaction that sets
  `status: "delivered"`, so the driver can immediately receive another
  offer (see "Request Claiming" above and "Dispatch Offers").
- **Customer confirmation** — a separate, resident-facing 24-hour
  window (`appConfig.deliveryConfirmationWindowHours`,
  `src/lib/domain/config.ts`) during which the resident may confirm or
  dispute the delivery. Nothing about this window ever touches driver
  availability or `activeRequestId` — confirming, disputing, or the
  window silently expiring all happen entirely on the request document.

## No separate "unconfirmed" status

There is no `delivered_unconfirmed` status. `WaterRequestStatus` has
exactly `"delivered"` and `"confirmed"` for this part of the lifecycle.
A delivered request that has not yet been confirmed is simply
`status === "delivered"`; whether it is "genuinely still waiting" or
"past its deadline and about to auto-resolve" is a computed, not
persisted, distinction (`isConfirmationWindowExpired()` in
`src/lib/domain/deliveryConfirmation.ts`). Display code should use this
computation (see `SummaryMetrics.awaitingConfirmation` in
`statistics.ts`) rather than introducing a new persisted status.

## Auto-confirmation

`checkDeliveryConfirmationTimeout()` (`src/lib/domain/waterRequests.ts`)
is the single place this rule is enforced:

1. If the request is not `"delivered"`, or `deliveredAt` is missing, or
   the window has not yet expired, it is a no-op.
2. If the window has expired, a transaction re-checks the request is
   still `"delivered"` (in case the resident just confirmed/disputed
   concurrently) and, if so, atomically sets `status: "confirmed"` and
   `confirmedAt`, recording a `delivery_auto_confirmed` event with
   `actorId: null, actorRole: null` — the same "system-generated" event
   shape already used for `preferred_driver_expired`. This is never
   recorded as `customer_confirmed`, so the audit trail always
   distinguishes an actual resident confirmation from a timeout.

`confirmWaterDelivery()`, `disputeWaterDelivery()`, and
`confirmDeliveryByStaff()` all only accept `status === "delivered"` —
once auto-confirmed, the request is `"confirmed"` and these correctly
reject further action on it (`INVALID_STATUS_FOR_CONFIRM` /
`INVALID_STATUS_FOR_DISPUTE`).

## Lazy enforcement, not a scheduled job

V1 does **not** introduce a scheduled Cloud Function for this. Per
DEVIN.md "Do Not Overbuild", `checkDeliveryConfirmationTimeout()` is
called opportunistically wherever a `"delivered"` request is read by an
operational workflow:

- Resident portal (`src/app/resident/page.tsx`) — the resident's own
  active request.
- Dispatcher dashboard (`src/app/dispatcher/page.tsx`) — every currently
  `"delivered"` request whose window has expired, before rendering.
- Dispatcher request detail (`src/app/dispatcher/[requestId]/page.tsx`).
- `createWaterRequest()` — see "Resident Duplicate Protection" below.

This means auto-confirmation is **not guaranteed to happen at exactly
24 hours** — it happens the next time any of the above touches that
request. Do not claim exact-time execution in product communication;
the guarantee is "confirmed automatically no later than the next
relevant system access," which for an actively-used dispatcher
dashboard is effectively immediate in practice.

## Resident duplicate protection after timeout

`createWaterRequest()` must not permanently block a resident from
requesting again merely because an old delivered request's confirmation
window expired and nobody happened to open it. Before the one-active-
request transactional check runs, `createWaterRequest()` looks up the
resident's `"delivered"` request (if any) and calls
`checkDeliveryConfirmationTimeout()` on it first. If that request's
window has expired, it is auto-confirmed right there, so the subsequent
duplicate check (which only treats `"delivered"` as active, not
`"confirmed"`) no longer sees it as blocking. If the window has not yet
expired, the request is still legitimately active and the existing
`DUPLICATE_ACTIVE_REQUEST` behavior is unchanged.

---

# Delivery Profile Confirmation Reminder

See PRODUCT.md "Delivery Profile Confirmation Reminder" for the product
rationale. This section is the implementation reference.

## Decision logic (pure)

`evaluateDeliveryProfileReminder()`
(`src/lib/domain/deliveryProfileReminder.ts`, pure, no Firestore access
— same pattern as `dispatchSelection.ts` / `continuityReportData.ts` so
it is unit testable without a Firestore/Admin SDK context) takes:

```ts
{
  phone: string | null;
  village: string | null;
  deliveryDirections: string | null;
  deliveryProfileConfirmedAt: string | null; // ISO
  lastConfirmedDeliveryAt: string | null;    // ISO
  now?: Date;
}
```

and returns `{ show: boolean; mandatory: boolean; missingFields:
Array<"phone" | "village" | "deliveryDirections"> }`.

Rules, applied in order:

1. If `phone`, `village`, or `deliveryDirections` is blank/whitespace-
   only, `show: true, mandatory: true` with the specific missing
   field(s) — these are the same canonical `UserProfile` fields used
   everywhere else, no duplicate fields.
2. Otherwise compute the most recent MEANINGFUL verification as the
   later of `deliveryProfileConfirmedAt` and `lastConfirmedDeliveryAt`.
   If neither exists (never confirmed AND never had a completed
   delivery), `show: true, mandatory: false` (first Resident portal
   visit).
3. Otherwise, `show: true` if that date is at least
   `appConfig.deliveryProfileReminderWindowDays` (45) days old,
   else `show: false`.

Deliberately does NOT consider last login, login count, or account
creation date alone — see PRODUCT.md "Do Not Use Login Date."

## Data sources

- `deliveryProfileConfirmedAt` — `UserProfile` field (see "Suggested
  Firestore Model" `users/{uid}` above). Missing on historical documents
  that predate this field; `toUserProfile()` (`src/lib/domain/users.ts`)
  normalizes a missing value to `null` (never confirmed) rather than
  backfilling a fabricated timestamp — this is a prelaunch codebase, so
  no compatibility-layer backfill was added.
- `lastConfirmedDeliveryAt` — the resident's most recently `"confirmed"`
  request's `confirmedAt`, from the new
  `getMostRecentConfirmedRequest(customerId)`
  (`src/lib/domain/waterRequests.ts`). Only `"confirmed"` counts — never
  `"available"`, `"preferred_driver_hold"`, `"claimed"`, `"cancelled"`,
  or `"disputed"`, and NOT a currently `"delivered"` (awaiting
  confirmation) request, so a resident mid-delivery is never
  additionally nagged by this reminder while already handling that
  delivery. This includes deliveries auto-confirmed after the 24-hour
  window (`checkDeliveryConfirmationTimeout()`) — both a genuine
  customer confirmation and an auto-confirmation write the same
  `status: "confirmed"` / `confirmedAt` fields, so they are
  indistinguishable (and equally valid) at this query layer.

### Query efficiency

`getMostRecentConfirmedRequest()` is a targeted, indexed query
(`customerId ==`, `status ==`, `orderBy confirmedAt desc`, `limit 1`) —
it does not scan `getRequestsForCustomer()`'s full history on every
Resident portal visit. This requires a new composite index (none of the
existing `waterRequests` indexes cover `customerId + status +
confirmedAt`):

```json
{
  "collectionGroup": "waterRequests",
  "fields": [
    { "fieldPath": "customerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "confirmedAt", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ]
}
```

Added to `firestore.indexes.json` — **this must be deployed** (`firebase
deploy --only firestore:indexes`) before this feature can rely on the
query succeeding in production; Firestore rejects a composite query
without a matching index at runtime rather than silently scanning.

`src/app/resident/page.tsx` only calls this query when the required
delivery-profile fields are already complete — if any are missing, the
reminder is mandatory regardless, so the extra read is skipped entirely.

## Refreshing the confirmation

`updateUserProfile()` (`src/lib/domain/users.ts`) compares the
incoming phone/village/deliveryDirections against the currently stored
values before writing. If any of them actually changed, it also sets
`deliveryProfileConfirmedAt` to the server timestamp in the same write —
saving a real change to delivery-relevant information is itself an
active review, so the resident is not required to separately return to
the reminder modal and click "Everything Is Correct" right after. Saving
unrelated fields only (e.g. display name) does not refresh it.

`confirmDeliveryProfile(uid)` (`src/lib/domain/users.ts`) is the
"Everything Is Correct" operation. It:

- Never trusts a client-provided timestamp — always writes
  `FieldValue.serverTimestamp()`.
- Re-validates server-side that phone/village/deliveryDirections are all
  non-blank before writing, throwing `DELIVERY_PROFILE_INCOMPLETE`
  otherwise — this mirrors the UI (which never offers "Everything Is
  Correct" when required fields are missing) but must not depend on the
  UI alone (see DEVIN.md "Never rely on UI visibility for access
  control").
- Only ever confirms the calling resident's own profile —
  `confirmDeliveryProfileInfo()` (`src/app/resident/actions.ts`) resolves
  the uid from `requireRole("resident")`'s server-verified session, never
  from client input.

## UI

`src/app/resident/DeliveryProfileReminderModal.tsx` (client component)
is rendered by `src/app/resident/page.tsx` only when
`evaluateDeliveryProfileReminder(...).show` is true — the decision is
made server-side before the component ever mounts, so a multi-role user
on `/driver` or `/dispatcher` never evaluates or renders this at all
(it is not part of any shared portal layout).

- **Mandatory** (missing required fields): no close (`X`)/backdrop
  dismissal, no "Everything Is Correct" button; only "Review My
  Information," which scrolls to the existing `ProfileForm` (anchored
  via `#delivery-profile-form` on the same page) — no second profile
  editor was built for this modal.
- **Periodic** (complete but stale): both "Review My Information" and
  "Everything Is Correct" are offered; the resident may also dismiss via
  `X`/backdrop. Dismissal is purely local UI state — it never calls the
  confirm action, so the reminder reappears on the resident's next
  portal visit exactly as before, per PRODUCT.md.
- The modal displays the resident's current phone/village/delivery
  directions so confirmation is meaningful.

## Firestore rules

No `firestore.rules` change was required. `users/{userId}` writes are
already restricted to the owning uid and already permit updating
arbitrary non-`roles` fields on self (see "Suggested Firestore Model" /
existing `users/{userId}` rule) — the same posture already governing
phone/village/deliveryDirections. All application writes to
`deliveryProfileConfirmedAt` go through `src/lib/domain/users.ts` via
the Admin SDK using `FieldValue.serverTimestamp()`, exactly like every
other profile field.

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
checkDeliveryConfirmationTimeout()
cancelWaterRequest()
expirePreferredDriverHold()
getNextOfferForDriver()
acceptDriverOffer()
declineDriverOffer()
getDispatchSettings()
updateDispatchSettings()
findActiveRequestsByPhone()
getActiveCustomerIds()
confirmDeliveryByStaff()
changeRequestPriority()
reevaluatePreferredDriverHoldForPriority()
getOutstandingRequestsForContinuityReport()
getMostRecentConfirmedRequest()
```

`src/lib/domain/deliveryProfileReminder.ts` (pure, no Firestore access —
see "Delivery Profile Confirmation Reminder" above):

```text
evaluateDeliveryProfileReminder()
```

`src/lib/domain/users.ts` additions for this feature:

```text
confirmDeliveryProfile()
```

`src/lib/domain/deliveryConfirmation.ts` (pure, no Firestore access —
see "Delivery Confirmation Timeout" above):

```text
confirmationDeadline()
isConfirmationWindowExpired()
```

`src/lib/domain/priority.ts` (pure, no Firestore access):

```text
determineInitialDispatchPriority()
priorityRankFor()
isValidDispatchPriority()
```

`src/lib/domain/waterSituation.ts` (pure, no Firestore access — factored
out of `waterRequests.ts` so it can be unit tested without a Firestore/
Admin SDK context, same pattern as `dispatchSelection.ts`):

```text
buildWaterSituationSnapshot()
```

`src/lib/domain/continuityReportData.ts` (pure, no Firestore access —
see "Operational Continuity Snapshot" above):

```text
buildContinuityReportData()
```

`src/lib/domain/continuityReport.ts` (`server-only` orchestrator):

```text
generateContinuityReportData()
```

Driver Registry operations live in `src/lib/domain/driverRegistry.ts`:

```text
createDriver()
updateDriver()
linkDriverAccount()
unlinkDriverAccount()
unlinkDriverAccountByUserId()
restrictDriver()
restoreDriver()
setAvailabilityByLinkedUser()
startCooldownByLinkedUser()
getEligibleDriverOptions()
isDriverImmediatelyAvailable()
setMeterAssignment()
removeMeterAssignment()
seedInitialRoster()
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

Viewers should have read-only access to operational data (requests,
driver status, statistics) and explicitly NOT to the admin user
directory (`users/{userId}` reads remain `isStaff()`-only — see "Viewer
Role" below).

Privileged operations such as role changes, delivery access restrictions, driver-registry creation/linking/meter changes, and forced reassignments should happen through trusted server-side code.

Design Firestore queries together with Security Rules.

Do not assume Security Rules will filter unauthorized documents out of an overly broad query.

## Unregistered customers

An unregistered/manual request has `customerId: null`. The existing rule
`resource.data.customerId == request.auth.uid` remains safe for these
documents without modification: `request.auth.uid` is always a non-null
string for a signed-in user, so it can never equal `null` — no resident
can read another customer's unregistered request through this
comparison. Staff access (`isStaff()`) is unaffected. This was reviewed
when dispatcher-created requests were added; no rule changes were
required.

## Driver Registry, fill stations, and viewer access

`driverRegistry/{id}` (and its `events`/`meters` subcollections) and
`fillStations/{id}` are readable by `isStaff() || isViewer()`; all
writes are `false` — every mutation goes through
`src/lib/domain/driverRegistry.ts` via the Admin SDK, which bypasses
these rules by design. Normal users cannot create themselves as
drivers, and `viewer` never has write capability anywhere.

`viewer` is added to `waterRequests` (and its `events` subcollection)
read access alongside `isStaff()`, since operational oversight is the
role's entire purpose. It is deliberately NOT added to `users/{userId}`
read access — the Viewer UI never needs the admin user directory, and
granting it would leak resident PII beyond what oversight requires (see
PRODUCT.md "Viewer Privacy").

---

# Viewer Role

`viewer` (`src/lib/domain/types.ts` `UserRole`) is enforced the same way
every other role is: `requireRole([...])` at the top of each
page/action, never by hiding UI. Concretely:

- `/viewer` (`src/app/viewer/page.tsx`) requires `requireRole("viewer")`.
- `/statistics` requires `requireRole(["dispatcher", "admin", "viewer"])`.
- Every dispatcher/admin mutating server action continues to require
  only `dispatcher`/`admin` — `viewer` is never added to those.
- `hasStaffAccess()` (`src/lib/auth/roles.ts`) deliberately excludes
  `viewer`; a new server action should default to requiring
  `dispatcher`/`admin` and only add `viewer` if it is read-only.

## Privacy-by-projection

The `/viewer` page builds a reduced, oversight-appropriate projection of
each `WaterRequest` **server-side**, before passing anything to JSX —
no phone, email, or full delivery directions. Because this is a Next.js
Server Component that renders plain HTML (not a Client Component
receiving the full object as a prop), the omitted fields never reach
the browser at all, not merely "hidden in the UI." Driver rows are
similarly reduced to name/eligibility/availability/link-status, omitting
the driver's own phone number.

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

## Client-side compression (cellular data)

Photo upload UI is not implemented yet (see DEVIN.md "Implementation
Sequence"), but the compression requirement is architected now because
government raised cellular-data usage as a launch concern (see
PRODUCT.md "Photo Cellular-Data Requirements"). When implemented:

- Images MUST be resized/compressed client-side (browser-side, before
  any network request) — never upload an original full-resolution
  phone photo, and never upload both an original and a compressed copy.
- All compression parameters (max long dimension, format, quality,
  max compressed size, max photos per upload) are centralized in
  `src/lib/domain/photoConfig.ts` (`photoUploadConfig`) — no call site
  should hard-code these numbers. Tuning after real-world testing on
  Saba's cellular network means editing exactly one file.
- Orientation must be baked into the re-encoded pixels before other
  EXIF metadata (GPS, device info) is stripped, so a compressed photo
  never displays sideways.
- Compression/upload failure must produce an immediate, clear error —
  never a silent, unbounded retry loop that keeps consuming cellular
  data.

## Photo Failure Testing Requirements

Add explicit tests for these scenarios before shipping any photo
upload UI: a large modern phone photo, a slow cellular connection, an
interrupted upload, upload retry behavior, browser memory usage with
multiple photos queued, compression failure, an unsupported image
format, file-size validation, and orientation correctness after
compression. See PRODUCT.md "Photo Cellular-Data Requirements" for the
product-level rationale.

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

- Request creation (distinguishing resident-submitted vs dispatcher-created)
- Preferred-driver selection/expiration/decline
- Driver claim
- Manual assignment/reassignment
- Delivery marking
- Customer confirmation
- Staff confirmation on behalf of an unregistered customer
- Customer dispute
- Cancellation
- Driver delivery access restricted
- Driver delivery access restored
- Driver Registry entry created/updated
- Driver account linked/unlinked
- Fill-station meter assignment added/updated/removed
- Property photo uploaded/updated/removed
- Request photo uploaded

For administrative actions, record the responsible user.

Avoid destructive history changes where an event record is more appropriate.

---

# Saba Operational Timezone

The application's operational timezone is `America/Puerto_Rico`
(`appConfig.operationalTimezone`, `src/lib/domain/config.ts`) — a fixed
UTC-4 offset year-round, matching Saba's actual clock, with no daylight
saving to account for.

**Firestore timestamps are never altered.** Every stored `Timestamp`
remains a proper absolute instant. Only two things are Saba-local:

1. **Display formatting** — every place the app shows an absolute
   moment in time (request submitted, claimed, delivered, confirmed;
   dispatcher/admin/driver event history; role history; cooldown
   expiration; dispatch-settings "last updated"; etc.) uses
   `src/lib/utils/datetime.ts` (`formatSabaDateTime` / `formatSabaDate` /
   `formatSabaTime`), which passes an explicit `timeZone` option to
   `Intl`/`toLocaleString`. This means a viewer in any browser timezone,
   or a server process running in any timezone (e.g. Vercel functions
   default to UTC), sees the same genuine Saba time — never the
   server's or browser's own zone.
2. **Calendar boundaries** — "today," "this month," "this year" as used
   by the driver decline-limit day and the statistics "this month"/"this
   year" periods are computed as real UTC instants via
   `startOfSabaDay()` / `startOfSabaMonth()` / `startOfSabaYear()`
   (same file). The offset is derived from `Intl` at the instant in
   question rather than hard-coded, so this keeps working correctly even
   if the configured zone is later changed to one that observes DST.

**Elapsed durations are unaffected and need nothing from this module** —
"2h ago," the 1-hour decline cooldown, the 24-hour preferred-driver
window, and the 24-hour delivery confirmation window are plain
millisecond differences, not calendar-anchored, so they are correct in
any timezone by construction.

Do not hard-code a `-4` (or any) hour offset anywhere else in the
codebase. If a new feature needs Saba-local display or a new calendar
boundary, add it to `src/lib/utils/datetime.ts` rather than
reimplementing timezone math at the call site.

## Calendar-Day Logic

The one place a calendar day matters operationally is
`maxDeclinesPerDay` (`countDeclinesToday()`,
`src/lib/domain/driverOffers.ts`): it bounds its Firestore query with a
generous 26-hour lookback, then filters precisely by comparing each
decline's Saba-local calendar date (`sabaCalendarDateKey()`) against
today's Saba-local calendar date. This resets at Saba local midnight,
never UTC midnight.

Statistics "This month" / "This year" periods use
`startOfSabaMonth()` / `startOfSabaYear()` as the Firestore query lower
bound (see `getPeriodStart()` in `src/lib/domain/statistics.ts`).
"Last 7 days" / "Last 30 days" are plain elapsed-duration windows
(`now - N days`), which are correct in any timezone and intentionally
do not use calendar boundaries.

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

Dispatcher-created requests count toward every metric identically to
resident-submitted ones (same demand, same gallons, same driver/village/
preferred-driver/dispute calculations) — `source` is preserved on each
request purely to answer "how many requests came in online vs were
entered by staff," not to segregate them from the rest of the numbers.
See `SummaryMetrics.bySource` in `src/lib/domain/statistics.ts`.

`SummaryMetrics.byPriority`, `CurrentOperationalMetrics.criticalOutstanding`
/ `urgentOutstanding`, and `StatsData.priorityTiming` (count and average
request-to-delivery time per priority level) report on `dispatchPriority`
using the CURRENT value (including any dispatcher override) — they are
request-level aggregates only, never joined with resident identity or
village, so priority statistics can never be used to rank individual
residents or villages by urgency (see PRODUCT.md "Privacy").

Design indexes intentionally as query patterns become clear.

---

# Operational Continuity Snapshot

See PRODUCT.md "Operational Continuity Snapshot" for the product
rationale. This is the implementation reference.

## Architecture

Data selection/transformation is deliberately split from delivery
infrastructure (PDF rendering, email) so the report content can be unit
tested without Firestore or network access:

- `src/lib/domain/continuityReportData.ts` — **pure**, no Firestore, no
  `server-only`. `buildContinuityReportData(requests, driverNamesByUserId,
  generatedAt)` filters/sorts/transforms already-fetched requests into
  `{ generatedAt, unassigned: UnassignedReportRow[], assigned:
  AssignedReportRow[] }`. Unassigned = `requested` /
  `preferred_driver_hold` / `available`; assigned = `claimed`; everything
  else (`delivered`, `confirmed`, `cancelled`) is excluded. Sorted by
  `priorityRank` then `requestedAt`, same convention as dispatch
  ordering. Never copies `waterSituation` onto a row — see "Privacy"
  below. Unit tested in
  `src/lib/domain/__tests__/continuityReportData.test.ts`.
- `src/lib/domain/continuityReport.ts` — `server-only` orchestrator.
  `generateContinuityReportData()` fetches outstanding requests
  (`getOutstandingRequestsForContinuityReport()` in `waterRequests.ts`,
  which queries `status in ["requested", "preferred_driver_hold",
  "available", "claimed"]` — reuses the existing `status ASC,
  requestedAt ASC` composite index, no new index required) and all
  driver registry entries (`getAllDriverRegistryEntries()`), builds a
  `linkedUserId -> displayName` map, and calls
  `buildContinuityReportData()`. Read-only — never writes anything.
- `src/lib/reports/continuityReportFilename.ts` — **pure**.
  `continuityReportPdfFilename(generatedAt)` builds the PDF filename
  (e.g. `saba-water-delivery-snapshot-2026-08-21.pdf`) using the Saba
  LOCAL calendar date, never the server/UTC date — the nightly report
  generates at 8:00 PM Saba time, which is midnight UTC, so the UTC
  calendar date is a day ahead of the Saba calendar date at that exact
  moment. Contains no customer data. Re-exported from
  `continuityReportPdf.ts` for callers.
- `src/lib/reports/continuityReportPdf.ts` — `renderContinuityReportPdf(data)`
  renders the report to a PDF `Buffer` using `pdfkit`. One
  implementation, shared by both the nightly job and the manual actions
  (see DEVIN.md "Do Not Overbuild" — no duplicate PDF code, no templating
  engine, no report-management platform).
- `src/lib/email/continuityReportEmailContent.ts` — **pure**, no
  `server-only`, no Resend SDK import. `parseRecipientList()`,
  `getContinuityReportEmailConfig()`, and
  `buildContinuityReportEmailPayload(pdfBuffer, data, config)` (the
  exact object passed to Resend) are all unit tested directly without
  mocking the Resend SDK or making a network call.
- `src/lib/email/continuityReportEmail.ts` — thin `server-only` wrapper.
  `sendContinuityReportEmail(pdfBuffer, data)` reads config, builds the
  payload via the pure module above, and calls Resend's
  `emails.send()`. Returns `{ ok, error? }` and never throws — see
  "Reliability" below.

## Report contents

**Unassigned Loads**: priority, customer name, phone, village, delivery
directions, requested time (Saba local), age (elapsed since
`requestedAt`), preferred driver name (if any), gallons.

**Assigned Loads**: priority, customer name, phone, village, delivery
directions, assigned driver name, requested time, claimed time, gallons.

A "delivered, awaiting confirmation" section was considered but not
built for V1 — those deliveries have already physically occurred, so
they are not outstanding driver work during an outage (see PRODUCT.md).

## Scheduling

Desired time is 8:00 PM Saba time
(`appConfig.operationalTimezone`, `America/Puerto_Rico`, a fixed UTC-4
with no daylight saving — see "Saba Operational Timezone"). Because the
offset never changes, 8:00 PM Saba time is always exactly midnight UTC,
so `vercel.json`'s cron schedule (`"0 0 * * *"`, evaluated in UTC by
Vercel) requires no runtime timezone conversion or DST handling:

```json
{ "crons": [{ "path": "/api/cron/continuity-report", "schedule": "0 0 * * *" }] }
```

**Deployment verification required**: Vercel Cron Jobs are available on
the Hobby plan, but Hobby-plan cron jobs are limited to at most **2 per
day per project** and Vercel does not guarantee exact-minute execution
on Hobby (invocation may occur anytime within the scheduled hour). Pro
plan is required for cron jobs with second/minute-level scheduling
guarantees and no per-project frequency floor. Confirm the project's
actual Vercel plan and cron limits in the Vercel dashboard before
relying on the schedule for a real continuity guarantee — this cannot
be verified from the repository alone.

`src/app/api/cron/continuity-report/route.ts` is the invoked endpoint.
It is protected by an optional `CRON_SECRET` environment variable —
when set, Vercel automatically sends `Authorization: Bearer
$CRON_SECRET`, and the route rejects any request without a matching
header. If `CRON_SECRET` is unset, the endpoint is unauthenticated
(acceptable only if the path itself is not discoverable/relied upon as
a security boundary) — setting `CRON_SECRET` in production is strongly
recommended and documented in `.env.example`.

## Email delivery

Email is sent via **Resend** (https://resend.com). Resend replaced an
earlier generic-SMTP (`nodemailer`) implementation — Resend's Node SDK
is simpler to configure correctly (a single API key, no transporter/
host/port/TLS settings to get right) and has first-class attachment and
error-result support. Configuration is entirely environment-variable-
driven (see `.env.example`):

- `RESEND_API_KEY` — server-only secret (never `NEXT_PUBLIC_`-prefixed;
  never sent to the client). Create it in the Resend dashboard under
  API Keys.
- `CONTINUITY_REPORT_EMAIL_FROM` — sender address. **Must be on a
  domain verified in Resend** (Resend > Domains) once real government
  email is used; until then, Resend's own test sender
  (`onboarding@resend.dev`) can be used for initial testing only. Never
  hard-code a personal address.
- `CONTINUITY_REPORT_EMAIL_TO` — comma-separated recipient list, parsed
  and trimmed by `parseRecipientList()` (e.g.
  `"a@example.com, b@example.com"` -> `["a@example.com",
  "b@example.com"]`).

If any of the three is missing, `getContinuityReportEmailConfig()`
returns `null` and `sendContinuityReportEmail()` returns a clear,
non-crashing error instead of silently pretending to send. Manual PDF
generation/download works regardless of whether email is configured —
see "Manual generation" below.

Subject: `Saba Water Delivery - Outstanding Delivery Snapshot
(<Saba-local date>)`. Body is a short plain-text message (see
`buildContinuityReportEmailPayload()`); the PDF is attached with the
Saba-local-dated filename from `continuityReportFilename.ts`.

## Manual generation and manual send

Two distinct staff-only actions, deliberately not merged into one,
because "let me see the current queue" and "email this out right now"
are different intents:

- **Generate Continuity Report** (download-only, no email) —
  `src/app/api/reports/continuity-snapshot/route.ts`, a `dispatcher`/
  `admin`-only (`requireRole`, same session-cookie authorization as the
  rest of those portals) GET route that calls
  `generateContinuityReportData()` and `renderContinuityReportPdf()` —
  the identical functions the nightly job uses — and streams the PDF
  directly to the browser as an attachment. Never sends email. Linked
  from the dispatcher dashboard (`src/app/dispatcher/page.tsx`).
- **Send Continuity Report Now** (email immediately) —
  `sendContinuityReportNow()` server action
  (`src/app/dispatcher/actions.ts`), `requireRole(["dispatcher",
  "admin"])`, rendered as a button by
  `src/app/dispatcher/SendContinuityReportButton.tsx`. Calls the exact
  same `generateContinuityReportData()` / `renderContinuityReportPdf()`
  / `sendContinuityReportEmail()` functions as the nightly cron job —
  no duplicate report-generation or email-sending logic. Returns a
  clear success (with unassigned/assigned counts) or error message
  inline.

## Privacy

The PDF is generated on demand and streamed directly to an authenticated
session, or emailed to a private configured address — it is never
written to public storage or served from a guessable public URL (no new
Firebase Storage usage was needed for this feature). Report rows never
include `waterSituation` fields (vulnerable circumstances, persons
affected, Critical explanation) — see `continuityReportData.ts`'s
row-building logic and its privacy-focused unit tests.

## Reliability

- **Read-only**: `generateContinuityReportData()` and everything it
  calls only reads Firestore. It never mutates a request or driver
  document, so generation is inherently idempotent and safe to retry —
  a retry (nightly re-invocation, a manual click, a failed cron attempt
  retried by Vercel) cannot corrupt or duplicate any dispatch state.
- **Email failure is isolated**: `sendContinuityReportEmail()` never
  throws; a failed send returns `{ ok: false, error }`, which the cron
  route logs (`console.error`, message only — never the Resend API key)
  and reflects in its HTTP status (502) so Vercel's cron dashboard shows
  the failure. It has no effect on `waterRequests` or `driverRegistry`
  data. No retry loop is implemented — Vercel Cron's own retry/monitoring
  behavior (if any, per plan) is relied on rather than a custom retry.
- **Generation failure is isolated**: any unexpected error during data
  fetch/PDF rendering is caught in the route handler, logged, and
  returned as a 500 — it cannot partially write anything, since nothing
  is ever written.
- **No secrets in logs**: only generic error messages (e.g. Resend's
  `error.message`) are logged, never the API key, and never full PDF
  contents.

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