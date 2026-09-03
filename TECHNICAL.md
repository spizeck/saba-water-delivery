# Water Delivery System Technical Guide

This document describes the implemented technical architecture of Saba
Water Delivery, developed for the Public Entity Saba. For project
provenance, volunteer basis, and intended handover, see
[`README.md`](../README.md).

## Architecture

Application stack:

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

## Progressive Web App and pilot deployment

The production pilot is deployed at
`https://saba-water-delivery.vercel.app`. `NEXT_PUBLIC_APP_URL` must use this
origin during the pilot and must be updated, followed by a production redeploy,
when the permanent DNS name becomes available.

The repository implements one PWA with portal-specific installation entry
points and manifests:

- `/driver/install` links `/driver-manifest.json`, whose `start_url` is
  `/driver` and whose scope is `/driver`.
- `/resident/install` links `/resident-manifest.json`, whose `start_url` is
  `/resident` and whose scope is `/resident`.
- The root `/manifest.json` covers the broader application. All manifests use
  standalone display, the existing water-drop branding, 192px and 512px icons,
  and maskable icon variants.
- `beforeinstallprompt` is used only where Chromium exposes it. iOS installation
  remains the Safari Share → Add to Home Screen flow. Standalone mode is
  detected through the display-mode media query and the iOS
  `navigator.standalone` property.

`public/sw.js` uses a deliberately narrow cache strategy. It precaches only the
static offline fallback, runtime-caches same-origin static assets, and handles
page navigation network-first. It does not cache authenticated HTML, Firebase
or Firestore data, API/auth responses, Server Action results, or writes. This
prevents operational data from being replayed to another account on a shared
device. Offline writes are not supported; the global connectivity banner and
`public/offline.html` tell the user to reconnect.

Firebase Authentication persistence and the HTTP-only server session cookie are
unchanged. Installing the PWA creates no account. Deep links, login/logout, and
multi-role switching continue through the same portal authorization boundaries
used in the browser.

---

# Authentication

Use Firebase Authentication.

Supported sign-in providers:

- Google
- Facebook
- Email/password

Authentication identifies the user.

Authorization must be controlled separately using application roles and Firestore Security Rules.

Never treat a hidden UI element as authorization.

---

# Roles

Current roles:

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

This is the implemented model as of the current codebase; use it as a
reference, but verify the exact fields in `src/lib/domain/types.ts` and
the domain modules before treating it as exhaustive.

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

  // Lifecycle: archive state (null when active, populated when archived).
  archivedAt: Timestamp | null
  archivedBy: string | null
  archiveReason: string | null
  archivedPreviousEligibilityStatus: "eligible" | "ineligible" | null
  archivedPreviousIneligibilityReason: string | null

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
driver_archived
driver_restored_from_archive
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

  loads: 1 | 2
  gallons: loads * 1000 // 1000 | 2000

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

## Water Collection Tracking

Each `WaterRequest` stores a `loadCollections: WaterLoadCollection[]` array with one immutable snapshot per physical load:

```ts
type WaterLoadCollection = {
  loadNumber: 1 | 2
  collectedAt: string
  fillStationId: string
  fillStationName: string
  meterCode: string
  meterNumber: number
  driverId: string
  recordedBy: string
  recordedByRole: UserRole
  note: string | null
}
```

The server-side `recordWaterCollection()` domain function validates request status, driver assignment, load number, active fill-station status, and meter assignment, then records the collection in a Firestore transaction. The driver's meter is resolved from `driverRegistry/{registryId}/meters/{stationId}` and snapshotted with the station details at collection time; statistics aggregate these snapshots rather than current meter assignments. Driver and staff reconciliation actions emit distinct `water_collected` and `water_collected_by_staff` audit events.

Delivery requires every requested load to have a collection record. Both `markWaterDelivered` and `markWaterDeliveredByStaff` reject with `LOADS_NOT_COLLECTED` when a load is missing. The pure, client-safe `loadCollection.ts` module (with no `server-only` import) exports `areAllLoadsCollected()` and `getMissingLoadNumbers()` for consistent enforcement and display. `types.ts` defines `DEFAULT_FILL_STATION_ID = "bottom"`, and all fill-station UI lists sort The Bottom first.

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

## Stale activeRequestId reconciliation

`activeRequestId` can become stale if the referenced request is deleted
(e.g. prelaunch data cleanup), delivered, cancelled, confirmed,
disputed, or reassigned to another driver without clearing the lock.

**Canonical validity rule:** `activeRequestId` is valid only when the
referenced request (1) exists, (2) has status `"claimed"`, (3) is
assigned to the same driver (`assignedDriverId === linkedUserId`).
Every other state is stale.

**Runtime self-healing:** `reconcileActiveRequest(driverId)` in
`src/lib/domain/driverRegistry.ts` checks the referenced request and
clears the lock if stale, recording a `stale_active_request_cleared`
audit event on the driver registry. The convenience wrapper
`reconcileActiveRequestByUserId(uid)` accepts a Firebase uid.

Pure validation logic is in `src/lib/domain/activeRequestValidation.ts`
(`checkActiveRequestValidity()`), separated for testability.

**Call sites** — reconciliation runs before:
- Rendering the driver portal (`src/app/driver/page.tsx`)
- Selecting the next offer (`getNextOfferForDriver` in `dispatch.ts`)
- Accepting an offer (`acceptOffer` in `src/app/driver/actions.ts`)
- Dispatcher assignment (`assignRequest` / `reassignRequest` in
  `src/app/dispatcher/actions.ts`)
- Determining driver immediate availability (`isDriverImmediatelyAvailable`)
- Computing dispatcher workload view (`src/app/dispatcher/page.tsx`)

**Prelaunch diagnostic:** `scripts/reconcile-stale-driver-locks.mjs`
identifies and optionally clears stale locks in bulk. Runtime
self-healing is required regardless; the script is for one-time cleanup.

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

The decline path uses a single Firestore transaction in `declineDriverOffer()`:
it records the offer as `"declined"`, expires any duplicate pending offers
for the same request, releases an active preferred-driver hold if
applicable, counts the driver's declines for the current local day, and,
if the configured `config/dispatchSettings.maxDeclinesPerDay` (default 3) is
reached, updates `driverRegistry/{driverId}.cooldownUntil` to
`now + declineCooldownHours` (default 1 hour) and records a
`driver_cooldown_started` driver event.

`declineDriverOffer()` returns a `DeclineDriverOfferResult`:

```text
{
  declined: true,
  availabilityStatus: "available" | "cooldown" | "daily_limit",
  cooldownUntil: string | null,
  declineCount: number,
  maxDeclinesPerDay: number
}
```

`availabilityStatus` is classified by comparing the computed `cooldownUntil`
to the end of the current Saba-local day: if it extends past the end of the
day, it is `"daily_limit"`; otherwise it is `"cooldown"`. This lets the UI
show the correct message without hard-coding "1 hour" or "tomorrow".
`countDeclinesToday()` exists in `driverOffers.ts` for read-only queries, but
the authoritative counting is performed inside the decline transaction.

`cooldownUntil` is intentionally separate from `eligibilityStatus`
(government authorization) and `availabilityStatus` (the driver's own
online/offline preference) — see PRODUCT.md "Driver Availability" and
"Dispatch Offers". While in cooldown:

- The driver receives no new offers (`getNextOfferForDriver()` prerequisite,
  enforced by the caller in `src/app/driver/page.tsx`).
- `setAvailabilityByLinkedUser()` rejects a transition to `"online"` with
  `DRIVER_IN_COOLDOWN` and includes the `cooldownUntil` ISO timestamp and a
  boolean `isDailyLimit` flag. The action maps this to a driver-facing
  explanation that includes the exact time or the "rest of today" reason.
  A driver cannot bypass the cooldown by toggling offline and back online,
  because enforcement compares `cooldownUntil` against server time, not client
  state.
- Existing claimed deliveries and `markWaterDelivered()` remain fully
  available.

### Local-day decline counting and timezone

"Per day" is defined using the local operational day for Saba, configured
as `appConfig.operationalTimezone` (`America/Puerto_Rico`, a fixed
UTC-4 offset with no daylight saving, matching Saba's actual clock —
see "Saba Operational Timezone" below). `countDeclinesToday()`
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

# Batch Dispatch

See PRODUCT.md "Batch Dispatch" for the product rationale. This is a
deliberate, dispatcher-controlled EXCEPTION to the normal one-offer-
at-a-time driver dispatch model (`dispatch.ts`, above) — never a
replacement for it, and never available to residents or drivers
themselves.

```text
/dispatcher/batches/new -> createBatch() server action
  -> createDispatchBatch() (atomic transaction)
  -> redirect to /dispatcher/batches/[batchId]
  -> GET /api/dispatcher/batches/[batchId]/pdf (download/reprint)
```

## Domain logic

- `src/lib/domain/dispatchBatchSelection.ts` — **pure**, no Firestore:
  `sortForBatchSelection()` (priority-then-age ordering, same
  convention as `dispatchSelection.ts`/continuity report),
  `validateBatchSelection()` (every validation rule, reusable by both
  the live transaction and unit tests), `computeDispatchBatchStatus()`,
  and the `MAX_BATCH_SIZE` constant.
- `src/lib/domain/dispatchBatches.ts` — `server-only` orchestrator:
  `createDispatchBatch()`, `getDispatchBatch()`,
  `getAllDispatchBatches()`, `getDispatchBatchEvents()`,
  `recordBatchGenerated()`.
- `src/lib/domain/waterRequests.ts` additions: `getBatchEligibleRequests()`,
  `getRequestsForDispatchBatch()`, `recordBatchDeliveryByStaff()`, plus
  batch-aware changes to `markWaterDelivered()`, `cancelWaterRequest()`,
  `dispatcherReassign()`, and `resolveDisputeReopened()` (see
  "Interaction with activeRequestId" below).
- `src/lib/domain/dispatchBatchPdfData.ts` — **pure** run-sheet data
  shaping, same pattern as `continuityReportData.ts`.
- `src/lib/reports/dispatchBatchPdf.ts` — PDFKit rendering, and
  `src/lib/reports/dispatchBatchPdfFilename.ts` — **pure** filename
  helper, both following the exact conventions of
  `continuityReportPdf.ts` / `continuityReportFilename.ts`.

## Canonical batch model

`dispatchBatches/{batchId}`:

```ts
{
  driverId: string        // linked account uid, never the registry doc ID
  createdBy: string
  createdAt: Timestamp
  status: "active" | "completed"
  originalRequestIds: string[]   // immutable historical record only
  generatedAt: Timestamp | null
  updatedAt: Timestamp
}
```

`originalRequestIds` is written once at creation and never mutated —
it is audit history, NOT the live membership list. A request's CURRENT
membership in a batch is determined by `waterRequests.dispatchBatchId`
pointing back at the batch (queried directly via
`getRequestsForDispatchBatch()`), because a request can leave a batch
(reassigned to a different driver, or cancelled) without rewriting
that array. This deliberately avoids two arrays that could drift out
of sync — there is exactly one place membership is read from.

Each `waterRequests` document gained:

```ts
dispatchBatchId: string | null
batchSequence: number | null   // 1-based run-sheet position
```

`dispatchBatchId` stays set through `claimed -> delivered -> confirmed`
(or `disputed`) — it is only cleared when the request is reassigned to
a DIFFERENT driver or cancelled, which genuinely detaches it from that
batch's current membership. This keeps a batch's detail page and
reprinted run sheet a complete, accurate picture of everything ever
assigned to it, including loads already resolved.

## Request status for batch assignment

**Chosen design: reuse the existing status enum (no new status).** A
batch-assigned request gets `status: "claimed"`, `assignedDriverId:
<driver>`, plus `dispatchBatchId`/`batchSequence` — the exact same
shape as a normal claim, not a parallel lifecycle. This was chosen
over inventing a new status because it requires zero changes to
`markWaterDelivered()`'s core transition, `confirmWaterDelivery()`,
`disputeWaterDelivery()`, `checkDeliveryConfirmationTimeout()`, or
`src/lib/domain/statistics.ts` — a batch-assigned load leaves the
general queue, cannot be claimed by anyone else, and completes through
the identical `claimed -> delivered -> confirmed`/`disputed` pipeline
already fully tested. `dispatchBatchId` is the only marker distinguishing
it, purely for dispatcher visibility and continuity-report/statistics
context — never branched on by driver-facing dispatch logic.

## Interaction with activeRequestId

This is the most important architectural decision in this feature.
`driverRegistry.activeRequestId` exists to enforce the one-active-
delivery invariant for the NORMAL self-claim/single-assignment
workflow (`claimWaterRequest()`, `dispatcherAssign()`,
`dispatcherReassign()`) — see "Request Claiming" above. Batch Dispatch
must let a driver hold several simultaneously claimed loads at once,
which is fundamentally incompatible with `activeRequestId` continuing
to mean "the one claimed request" if every batch load tried to set it.

**Chosen design: `createDispatchBatch()` never touches
`activeRequestId` at all.** Every batch-assigned request is written
with `status: "claimed"` while the driver's `activeRequestId` is left
exactly as it was (typically `null`, unless the driver separately has
a genuine self-claimed/singly-assigned active delivery, which is left
untouched too). This works cleanly with the EXISTING code, unmodified:

- `claimWaterRequest()`, `dispatcherAssign()`, and `dispatcherReassign()`
  each already contain a defensive fallback: when `activeRequestId` is
  unset, they query for ANY `"claimed"` request assigned to that
  driver before allowing a new claim/assignment — originally written
  to handle registry entries created before `activeRequestId` existed.
  This fallback already, correctly, blocks a driver from self-claiming
  or being singly-assigned a second request whenever they hold ANY
  claimed request, batch-assigned or not — with zero changes needed to
  those functions.
- `getNextOfferForDriver()` (`dispatch.ts`) calls
  `getClaimedRequestsForDriver()`, which queries `assignedDriverId +
  status == "claimed"` directly — not `activeRequestId` — so a driver
  holding batch-assigned claimed loads is already correctly offered
  nothing further, again with zero changes needed.

The one thing that DID need to change: several functions previously
cleared `driverRegistry.activeRequestId` **unconditionally** whenever
their request transitioned out of `"claimed"`
(`markWaterDelivered()`), or cleared it based only on "does the
previous driver have this field set to anything" without checking it
actually pointed at the request in question
(`dispatcherReassign()`'s previous-driver clear). Before Batch
Dispatch, this was always safe, because a driver could never hold more
than one claimed request, so `activeRequestId` (if set) always equaled
the request being resolved. Now that a driver can separately hold a
genuine active self-claimed delivery AND unrelated batch loads (which
never set `activeRequestId`), an unconditional clear could incorrectly
release a different, still-active delivery. Both were fixed to only
clear `activeRequestId` when it currently equals the request being
resolved — matching the equality check `cancelWaterRequest()` and
`resolveDisputeCompleted()`/`resolveDisputeReopened()` already used.
This is a pure correctness hardening with **zero behavior change**
for any request outside Batch Dispatch (the equality was always true
before this feature existed).

**The invariant that remains true:** normal driver self-claim can
never accumulate multiple active claimed requests — enforced by
unmodified, pre-existing code. Batch Dispatch is additive, not a
weakening of that guarantee.

## Batch status derivation

`DispatchBatchStatus` ("active" | "completed") is a maintained cache of
a value that could otherwise be recomputed from the batch's member
requests: "active" while at least one current member is still
`"claimed"`; "completed" once none remain (including the case where
every member has since been reassigned/cancelled out of the batch —
see `computeDispatchBatchStatus()` in `dispatchBatchSelection.ts`,
pure and unit tested). It is kept in sync, inside the SAME Firestore
transaction as the triggering change, by exactly four call sites:
`markWaterDelivered()`, `recordBatchDeliveryByStaff()`,
`cancelWaterRequest()`, and `dispatcherReassign()` — the only places a
batch member can leave `"claimed"` status or leave the batch's
membership entirely. `confirmWaterDelivery()`, `disputeWaterDelivery()`,
`resolveDisputeCompleted()`, and `checkDeliveryConfirmationTimeout()`
never need to touch it, since none of them can change whether a member
is still `"claimed"`. A small private helper,
`readBatchMemberStatusesForSync()` in `waterRequests.ts`, performs the
read (before any writes, as Firestore transactions require) and hands
back the computed status for the caller to write alongside its other
updates. It is implemented with raw Firestore reads rather than by
calling into `dispatchBatches.ts`, specifically to avoid a circular
module dependency (`dispatchBatches.ts` imports FROM `waterRequests.ts`
to hydrate `WaterRequest`s for its return values).

## Atomic assignment

`createDispatchBatch()` re-validates every selected request against
its LIVE Firestore state inside a single transaction — never trusting
whatever the dispatcher's review screen last displayed. Reads happen
first (the driver's registry entry, then every selected request
document); `validateBatchSelection()` (pure) is run against those
fresh reads; if it reports ANY issue — a request no longer exists, is
no longer in an eligible status, is a duplicate selection, or is a
preferred-driver hold for a different driver that was not explicitly
acknowledged — the function throws before any writes occur, and
Firestore transactions guarantee nothing in the batch was written.
There is no partial-assignment recovery path to build, because partial
assignment cannot happen: it is all-or-nothing by construction. A
caller who hits this must re-fetch the current eligible-requests list
and try again — this is what "fail cleanly and require refresh/review"
means in practice here.

## Preferred-driver overrides

A batch-eligible request can be `"preferred_driver_hold"` for a
resident's chosen driver. If the batch is being assigned to that SAME
driver, this is not an override at all. If it is being assigned to a
DIFFERENT driver, `validateBatchSelection()` requires the request's ID
to appear in the caller-supplied
`acknowledgedPreferredOverrideRequestIds` set, or it throws
`PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED:<requestId>` — the
dispatcher UI surfaces every such conflict explicitly (with the
preferred driver's name) and requires an affirmative checkbox before
the review step's submit button is enabled. This mirrors the existing
principle that a preference is never silently bypassed (see PRODUCT.md
"Preferred Driver"), extended to a batch context where no
existing single-assignment "override reason" mechanism existed to
reuse.

## Number of loads

`MAX_BATCH_SIZE = 25` (`dispatchBatchSelection.ts`) is a documented
technical safety bound, not a business policy: each assigned request
costs two writes (the request update and its audit event) inside the
creation transaction, so this keeps a full batch comfortably inside
Firestore's per-transaction mutation limit and the review screen
usable on a phone. Raise it only if a genuine operational need
appears — there is no product reason for the current number.

## Staff delivery reconciliation

`recordBatchDeliveryByStaff()` lets dispatcher/admin staff record a
batch-assigned load as delivered when the driver cannot (or did not)
mark it delivered themselves — the entire premise of Batch Dispatch is
supporting drivers whose phone/data access may be unreliable, so this
capability is required for the feature to be operationally usable, not
optional polish. It closes a previously identified gap (see
docs/INCIDENT_RECOVERY.md "Recovery: reconciling manually handled
deliveries") for exactly this scenario. It is deliberately scoped
server-side to `dispatchBatchId != null` requests only — it throws
`NOT_BATCH_ASSIGNED` for anything else — so it is not a general
"staff can mark any delivery delivered" shortcut that would undermine
the normal driver-completion audit trail. It records a distinct
`marked_delivered_by_dispatcher_batch` event, never `marked_delivered`,
so the audit trail never misrepresents a staff paper-reconciliation
entry as the driver's own action (same principle as
`delivery_confirmed_by_dispatcher` vs `customer_confirmed`). Each load
is still recorded individually — there is no bulk "mark entire batch
delivered" action (see DEVIN.md "Batch Dispatch" "Do Not Implement").

## Reassignment and cancellation

`dispatcherReassign()` now detaches a request from its current batch
(clearing `dispatchBatchId`/`batchSequence` and recording a
`dispatcher_batch_membership_removed` event) whenever it is reassigned
to a genuinely DIFFERENT driver — reassigning "to" the same driver it
is already assigned to is a no-op and does not detach it.
`cancelWaterRequest()` does the same when cancelling a batch member.
`resolveDisputeReopened()` clears it too, since a reopened dispute
returns the request to the general unassigned queue. In every case the
rest of the batch's membership and history is untouched — see
`readBatchMemberStatusesForSync()` above for how the batch's derived
status stays correct afterward.

## Continuity report integration

`AssignedReportRow` gained `isBatchAssigned: boolean`
(`continuityReportData.ts`), set from `r.dispatchBatchId != null` — no
other change was needed, since a batch-assigned request is already
`status: "claimed"` and therefore already included in the report's
existing "Assigned Requests" section
(`getOutstandingRequestsForContinuityReport()` already includes
`"claimed"`). `continuityReportPdf.ts` prints `(Batch)` after the
driver's name on such rows, purely for staff context during an
outage — see PRODUCT.md "Batch Dispatch" "Statistics and the
continuity report."

## Statistics

No changes were made to `src/lib/domain/statistics.ts`. Because a
batch-assigned request uses the exact same `status`/timestamp fields
as any other claimed/delivered/confirmed request, it is already
counted identically for gallons, village demand, priority, delivery
timing, and driver attribution — `dispatchBatchId` is preserved on the
document for potential future operational reporting, but no existing
statistic needed to change to remain correct.

## Firestore indexes and rules

One new composite index was required:
`waterRequests`: `dispatchBatchId ASC, batchSequence ASC, __name__ ASC`
(for `getRequestsForDispatchBatch()`). `getBatchEligibleRequests()`
reuses the existing `status + priorityRank + requestedAt` index — an
`"in"` equality filter on the first field of an existing composite
index does not require a new one. `getAllDispatchBatches()` uses a
single `orderBy("createdAt")`, which needs no composite index.

`dispatchBatches/{batchId}` (and its `events` subcollection) follow the
same rules posture as `driverRegistry`: readable by `isStaff() ||
isViewer()`, all writes `false` (Admin SDK only, via
`dispatchBatches.ts`).

## PDFKit / Vercel deployment

The run sheet reuses the exact same `renderDispatchBatchPdf()` /
PDFKit setup as the continuity report — see "Operational Continuity
Snapshot" above for the full history of the production `Helvetica.afm`
failure and why both `serverExternalPackages: ["pdfkit"]` AND
`outputFileTracingIncludes` are required together. The new PDF entry
point is `GET /api/dispatcher/batches/[batchId]/pdf`
(`src/app/api/dispatcher/batches/[batchId]/pdf/route.ts`) — the ONLY
route whose server bundle can reach `renderDispatchBatchPdf()` (unlike
the continuity report, no dispatcher page or server action imports it
directly). `next.config.ts`'s `outputFileTracingIncludes` gained:

```ts
"/api/dispatcher/batches/\\[batchId\\]/pdf": ["node_modules/pdfkit/js/data/**/*"],
```

The dynamic segment is escaped (`\\[batchId\\]`) because
`outputFileTracingIncludes` keys are matched with picomatch, which
would otherwise interpret `[batchId]` as a character class rather than
a literal route segment — see the Next.js "output" config reference's
own `/api/login/\\[\\[\\.\\.\\.slug\\]\\]` example. Verified after
`npm run build` by inspecting
`.next/server/app/api/dispatcher/batches/[batchId]/pdf/route.js` (a
literal `a.exports=require("pdfkit")`, no pdfkit source inlined) and
its `.nft.json` trace (all 15 files under `node_modules/pdfkit/js/data/`
present) — the same verification method used for the original
continuity-report fix. If a future route or server action is added
that can reach `renderDispatchBatchPdf()`, add its route path here too.

## Driver portal impact

No driver-portal UI restructuring was needed. `getClaimedRequestsForDriver()`
already returned an array and `ClaimedDeliveries.tsx` already rendered
one independent card (with its own "Mark Delivered" button) per
claimed request — both were already written generically, not assuming
exactly one claimed delivery, even though that was the only
possibility before this feature. The only change was a small "Batch
assignment" badge on a card when `request.dispatchBatchId` is set, so
a driver using the app understands why they suddenly have several
claimed deliveries instead of the usual one.

## Testing

Pure logic (`dispatchBatchSelection.ts`, `dispatchBatchPdfData.ts`,
`dispatchBatchPdfFilename.ts`) is fully unit tested without Firestore,
covering priority/age ordering, every validation rule (including the
race scenario — a request already claimed by someone else by the time
of validation — and the preferred-driver-override
acknowledgment requirement), and `computeDispatchBatchStatus()`.
`continuityReportData.test.ts` covers `isBatchAssigned`.
`createDispatchBatch()` itself (Firestore transactions) is not directly
unit tested — same precedent as `generateContinuityReportData()` and
the WhatsApp Firestore-backed modules — but its correctness rests on
the same `validateBatchSelection()` used by fresh reads inside the
transaction, which is directly tested.

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
  Auth account is created unless the dispatcher explicitly opts to send
  an account-setup invitation (see "Optional account invitation" below).
  `createWaterRequest()` requires a `customer` snapshot
  (`displayName` + `phone`; `email` optional) and skips the
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
- Unregistered customer: soft warnings only.
  - `findActiveRequestsByPhone()` looks for unresolved requests with a
    matching `customer.phone`. Phone matching is not identity
    verification (shared household phones, typos, reused numbers), so a
    match blocks nothing by itself — the dispatcher action returns a
    `"duplicate_warning"` state with the matching request(s), and staff
    can explicitly acknowledge and proceed. Proceeding is recorded on
    the creation audit event as `overrodeDuplicateWarningFor:
    [requestId, ...]` — never silent.
  - Identity matching against the resident directory (`src/lib/domain/
    identityMatching.ts`) surfaces possible existing residents when the
    dispatcher-entered email or phone matches. Email matches are strong;
    phone matches are medium (reviewable); name-only matches are weak
    and never used to auto-select an account. The dispatcher can choose
    to use an existing account, proceed unregistered, or (for a new
    email) send an account-setup invitation.
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

## Optional account invitation

When a dispatcher creates a request for an unregistered requestor and
enters an email address, `checkEmailAccountStatus()` looks up the email
in Firebase Authentication. If an account already exists, the dispatcher
can create the request as a registered request for that account. If no
account exists, the dispatcher may check "Send account setup
instructions". `createAccountInvitation()`:

1. Creates a new Firebase Auth user with that email (no password).
2. Generates a password-reset link via `generatePasswordResetLink()`.
3. Sends a branded email through Resend with the secure link.

The dispatcher never sees or stores a password. The current request
remains `customerId: null` (unregistered) even after an invitation is
sent; when the resident later signs in, staff can link historical
requests through the admin workflow. If the email send fails, the water
request is still created and the dispatcher is warned
(`"invitation_warning"` action state) — the government service is never
blocked by an optional account email.

See `src/lib/domain/identity.ts` and `src/lib/email/accountSetupEmail.ts`.

---

# Identity Matching, Linking, and Account Merging

Resident identity is deliberately lightweight in V1: authenticated users
have `users/{uid}` documents, and unregistered requestors are stored as
snapshots on `waterRequests`. There is no separate `residentProfiles`
collection, to avoid a prelaunch refactor of the entire request
workflow. Instead, pure matching helpers (`src/lib/domain/
identityMatching.ts`) and admin-only server actions (`src/lib/domain/
identity.ts`) provide identity management.

## Matching rules

`identityMatching.ts` exposes conservative matching functions used by
both the dispatcher create-request form and admin tools:

- `normalizePhoneForMatching()` strips non-digits — same convention as
  WhatsApp matching.
- `normalizeEmailForMatching()` lowercases and trims.
- `findIdentityMatches()` returns matches with a strength:
  - **strong** — exact normalized email match.
  - **medium** — exact normalized phone match (reviewable, because phones
    are shared/reassigned).
  - **weak** — name similarity only; never used for automatic linking.

## Historical request relinking

Admin user detail pages (`/admin/users/[uid]`) include a **Link
Historical Requests** panel. `findPossibleRequestHistoryMatchesForUser()`
finds unregistered requests whose stored customer snapshot matches the
user's email or phone. `linkRequestHistoryToUser()` updates
`customerId` from `null` to the target uid inside a Firestore
transaction, preserving the original `customer` snapshot and writing a
`customer_history_linked` audit event per request. Historical actor
fields (createdBy, assignedDriverId, etc.) are not rewritten.

## Authenticated account merge

`/admin/users/merge` lets an admin consolidate two authenticated
accounts. `getAccountMergePreview()` returns comparison data including
role lists, driver registry links, and duplicate-owned request counts.
`mergeUserAccounts()` performs the merge with these safeguards:

- **Request ownership** (`customerId`) relinked from duplicate to canonical.
- **Driver registry link** moved only if the canonical account is not
  already linked to a different registry entry; if both accounts are
  linked to different entries, the merge is blocked.
- **Role merge policy**:
  - `union` — unions only non-sensitive roles (`resident`, `viewer`).
    Admin, dispatcher, and driver roles are never transferred
    automatically.
  - `explicit` — admin selects the exact final role list; this is the
    only way to transfer sensitive roles.
- **Duplicate Firebase Auth account** is deleted only after Firestore
  relinking succeeds. If deletion fails, the audit record captures the
  error so staff can retry or clean up manually.
- **Audit record** is written to `accountMergeEvents/{eventId}` with
  canonical/duplicate uids, actor, reason, role decision, driver link
  decision, relink counts, and any deletion error.

## Provider linking vs. account merging

Firebase Authentication's native provider linking lets one Firebase UID
accumulate multiple login providers (Google, Facebook, email) — this is
preferred when the same person created separate-provider sessions before
signing in. Account merging (above) is the administrative exception
workflow for two already-distinct Firebase UIDs that must be consolidated
because a resident signed up twice with different email addresses or
otherwise ended up with duplicate application accounts.

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
Array<"phone" | "village" | "deliveryDirections">; invalidFields:
Array<"phone" | "village" | "deliveryDirections"> }`.

Rules, applied in order:

1. If `phone`, `village`, or `deliveryDirections` is blank/whitespace-
   only, `show: true, mandatory: true` with the specific missing
   field(s) — these are the same canonical `UserProfile` fields used
   everywhere else, no duplicate fields.
1b. If `village` is present but not one of the five canonical Saba
   villages, `show: true, mandatory: true` with `invalidFields:
   ["village"]` (the UI displays this as "Needs update" rather than
   "Missing").
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
  non-blank and that `village` is one of the five canonical Saba
  villages before writing, throwing `DELIVERY_PROFILE_INCOMPLETE`
  otherwise — this mirrors the UI (which never offers "Everything Is
  Correct" when required fields are missing or invalid) but must not
  depend on the UI alone (see DEVIN.md "Never rely on UI visibility for
  access control").
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

- **Mandatory** (missing or invalid required fields): no close
  (`X`)/backdrop dismissal, no "Everything Is Correct" button; only
  "Review My Information," which scrolls to the existing `ProfileForm`
  (anchored via `#delivery-profile-form` on the same page) — no second
  profile editor was built for this modal. A noncanonical village is
  shown as "Needs update" rather than blank.
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
archiveDriver()
restoreArchivedDriver()
getDeleteDriverEligibility()
deleteDriver()
getActiveDriverRegistryEntries()
getArchivedDriverRegistryEntries()
setAvailabilityByLinkedUser()
startCooldownByLinkedUser()
getEligibleDriverOptions()
isDriverImmediatelyAvailable()
setMeterAssignment()
removeMeterAssignment()
```

The initial roster seed helper (`seedInitialRoster`) was removed from the
production module and moved to `scripts/seed-initial-roster.mjs` for
local/development use only.

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

Use each request's stored `gallons` value to calculate total gallons:

```text
sum(request.gallons for request in completedRequests)
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

**Unassigned Requests**: priority, customer name, phone, village, delivery
directions, requested time (Saba local), age (elapsed since
`requestedAt`), preferred driver name (if any), quantity (loads and gallons).

**Assigned Requests**: priority, customer name, phone, village, delivery
directions, assigned driver name, requested time, claimed time, quantity
(loads and gallons).

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

## Vercel deployment: pdfkit must be externalized from the server bundle

`pdfkit` resolves its built-in font metrics (`Helvetica.afm`, etc.,
under `node_modules/pdfkit/js/data/`) at **runtime** using a path
relative to its own `__dirname`
(`path.join(__dirname, "data", "Helvetica.afm")`), not a static
`import`/`require`.

This caused two distinct, sequential production bugs:

1. **Missing data files.** Next's Output File Tracing (which determines
   exactly which files Vercel bundles into each serverless function)
   only follows static `import`/`require`/`fs` calls it can analyze at
   build time — it cannot see pdfkit's dynamic `fs.readFileSync` path —
   so the `.afm` files were missing from the deployed function,
   producing `ENOENT: ... open '.../data/Helvetica.afm'` in production
   even though it worked locally (where `node_modules` is fully present
   on disk).
2. **Wrong `__dirname` after bundling (the deeper bug).** Adding
   `outputFileTracingIncludes` for `node_modules/pdfkit/js/data/**/*`
   alone was **not sufficient**: because pdfkit's code was being
   *bundled into* a webpack chunk (e.g. `.next/server/chunks/9.js`)
   rather than kept as its own module, pdfkit's `__dirname` at runtime
   resolved to that chunk's directory, not pdfkit's real package
   directory — so pdfkit looked for
   `/var/task/.next/server/chunks/data/Helvetica.afm`, which can never
   exist no matter what the trace copies under
   `node_modules/pdfkit/js/data/`.

Fixed with **both**, together:

- `serverExternalPackages: ["pdfkit"]` in `next.config.ts` — opts
  pdfkit out of Server Component/Route Handler bundling entirely, so it
  stays a real, unbundled `require("pdfkit")` at runtime (confirmed by
  inspecting the built route/page bundles: they contain a literal
  `a.exports=require("pdfkit")`, and no pdfkit source — no
  `AFMFont`/`class PDFDocument`/etc. — appears inlined in any
  `.next/server/chunks/*.js` file). With pdfkit unbundled, its own
  `__dirname` is the real `node_modules/pdfkit/js` directory again, so
  `path.join(__dirname, "data", "Helvetica.afm")` resolves correctly.
- `outputFileTracingIncludes` for `node_modules/pdfkit/js/data/**/*` —
  **still required** alongside `serverExternalPackages`: pdfkit's font
  files are still read via a runtime `fs.readFileSync`, so even with
  pdfkit now correctly traced as an external dependency (NFT
  automatically includes `node_modules/pdfkit/js/pdfkit.js` and
  `package.json` once it's a real `require`), the data directory still
  needs to be listed explicitly.

Both apply to every route whose server bundle can reach
`renderContinuityReportPdf()`: the two dedicated API routes
(`/api/cron/continuity-report`, `/api/reports/continuity-snapshot`) and
`/dispatcher` (which imports the "Send Continuity Report Now" server
action). If a new route or server action is added that can call
`renderContinuityReportPdf()`, add its route path to the
`outputFileTracingIncludes` map (no change to `serverExternalPackages`
is needed — it already applies package-wide, not per-route).

Verified after `npm run build` by inspecting
`.next/server/app/**/*.nft.json` and the built route/page `.js` files
directly:

- No `.next/server/chunks/*.js` file contains pdfkit's source.
- Each of the three routes' bundles contains a literal
  `a.exports=require("pdfkit")`.
- Each route's `.nft.json` trace includes
  `node_modules/pdfkit/package.json`, `node_modules/pdfkit/js/pdfkit.js`
  (pdfkit's actual — and, being a pre-bundled single-file package,
  self-contained — entry point, picked up automatically by NFT once the
  `require` is real), and all 15 files under
  `node_modules/pdfkit/js/data/`.

This was validated against real Vercel production deployment, not build
traces alone — see the final report for this change for the exact
production test results.

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

# WhatsApp Resident Ordering

See PRODUCT.md "WhatsApp Resident Ordering" for the product rationale.
This is the implementation reference. **Resident** ordering is
implemented; **driver** WhatsApp commands (see "Future WhatsApp
Integration" below) are not.

## Architecture

WhatsApp is a front end to the existing application — it calls the
exact same domain functions and writes to the exact same
`waterRequests` collection as the web app. No parallel requests
collection, dispatch logic, priority logic, preferred-driver logic, or
duplicate-protection logic was created.

```text
Meta webhook -> /api/webhooks/whatsapp -> idempotency claim
  -> handleIncomingWhatsAppMessage() (orchestrator)
     -> session load (whatsappSessions)
     -> resident identity match (residentMatch.ts)
     -> processMessage() (PURE conversation reducer)
     -> canonical domain functions (createWaterRequest, confirmWaterDelivery,
        disputeWaterDelivery, updateUserProfile — same as the web app)
     -> session save
     -> outbound WhatsApp message(s) (client.ts)
```

Split for testability (see DEVIN.md "Integration Boundaries" —
transport / state machine / identity matching / domain operations are
deliberately separated):

- `src/lib/whatsapp/types.ts` — session/step/context/action types.
- `src/lib/whatsapp/parsing.ts` — **pure**. Deterministic input parsing
  only (menu numbers, CONFIRM/CANCEL, village/vulnerable-circumstance/
  urgency menu choices, persons-affected/storage free text). No
  AI/intent classification anywhere in this module or any other.
- `src/lib/whatsapp/messages.ts` — **pure**. All outbound message
  copy/templates, so exact wording is reviewable/testable in isolation.
- `src/lib/whatsapp/phoneMatching.ts` — **pure**.
  `normalizePhoneForMatching()` (digits-only comparison) and
  `matchResidentByPhoneFromDirectory(rawPhone, directory)` (unique /
  none / ambiguous — see PRODUCT.md "Resident Identity Strategy").
- `src/lib/whatsapp/residentMatch.ts` — thin `server-only` wrapper:
  fetches `getResidentDirectory()` (the same directory dispatcher
  search already uses) and delegates to the pure matcher above.
- `src/lib/whatsapp/conversationSteps.ts` — **pure**.
  `processMessage(session, inboundText, context)` is the entire
  deterministic state machine: given the current session/step, the raw
  inbound text, and already-fetched context (active request, eligible
  drivers, registered profile), it returns the next session state,
  outbound message(s), and zero or more canonical domain
  `actions` to perform. It never touches Firestore/network itself, so
  it's fully unit tested (`src/lib/whatsapp/__tests__/conversationSteps.test.ts`)
  without mocking Meta or Firestore.
- `src/lib/whatsapp/session.ts` — `server-only` Firestore session CRUD
  (`whatsappSessions/{id}`, doc ID = SHA-256 of the normalized phone,
  never the raw phone number — see PRODUCT.md item 8) and lazy
  expiration (`appConfig.whatsappSessionExpirationHours`, default 24).
- `src/lib/whatsapp/idempotency.ts` — `server-only`.
  `claimMessageId(messageId)` uses Firestore's `create()` (fails if the
  doc already exists) as an atomic claim against
  `whatsappProcessedMessages/{sha256(messageId)}` — see "Webhook
  Idempotency" below.
- `src/lib/whatsapp/clientConfig.ts` — **pure**.
  `getWhatsAppClientConfig()`, `verifyWhatsAppWebhookChallenge()`
  (GET handshake), `verifyWhatsAppWebhookSignature()`
  (`X-Hub-Signature-256` HMAC-SHA256 verification, constant-time
  compare). No network call, so directly unit tested.
- `src/lib/whatsapp/client.ts` — `server-only`. Re-exports the pure
  config/verification functions above and adds
  `sendWhatsAppTextMessage()`, the one place that calls Meta's Graph
  API (`POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`).
- `src/lib/whatsapp/handleIncomingMessage.ts` — `server-only`
  orchestrator described in the diagram above. Maps canonical domain
  error codes (e.g. `DUPLICATE_ACTIVE_REQUEST`, `CRITICAL_EXPLANATION_REQUIRED`,
  `INVALID_STATUS_FOR_CONFIRM`) to resident-friendly text — never a raw
  error code, stack trace, or document ID (see PRODUCT.md "Error
  Handling").
- `src/app/api/webhooks/whatsapp/route.ts` — the public endpoint (see
  "Webhook Endpoint" below).
- `src/lib/domain/villages.ts` — **pure**. New canonical
  `SABA_VILLAGES` list, introduced specifically because no canonical
  village list/type existed anywhere before this phase (the web
  form/profile have always used free-text `village: string`) — see
  PRODUCT.md "Village Selection". Does not change `UserProfile`/
  `WaterRequest` field types.

## Environment variables

Server-only, never `NEXT_PUBLIC_`-prefixed (see .env.example):
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
`getWhatsAppClientConfig()` returns `null` (never throws) if any is
missing; the webhook route responds `503` rather than silently no-op'ing.

## Webhook endpoint

`GET /api/webhooks/whatsapp` — Meta's verification handshake.
Validates `hub.mode=subscribe` and `hub.verify_token` against
`WHATSAPP_VERIFY_TOKEN`; echoes `hub.challenge` back on success, `403`
otherwise.

`POST /api/webhooks/whatsapp` — inbound message delivery. Reads the
**raw** request body (`request.text()`, before any JSON parsing,
since Meta signs the exact bytes) and verifies `X-Hub-Signature-256`
before doing anything else — an invalid/missing signature is rejected
with `401` and never reaches message processing. No Firebase session
cookie is required or possible here (Meta cannot present one) — this
route is intentionally public but signature-verified instead, unlike
every other route in this application which uses `requireRole()`.

## Webhook idempotency (launch-critical)

Meta may retry webhook delivery for the same message. Every inbound
message ID is claimed via `claimMessageId()` **before** any
conversation processing:

- First delivery: `create()` succeeds -> process the message normally.
- Retry of the same message ID: `create()` fails (`ALREADY_EXISTS`) ->
  skip entirely, still respond `200` (so Meta stops retrying) but never
  call `handleIncomingWhatsAppMessage()` a second time.

This makes it structurally impossible for a Meta retry to advance the
conversation twice, create a duplicate water request, confirm/dispute a
delivery twice, or create duplicate audit events. Tested end-to-end at
the route level (mocking `claimMessageId`/`handleIncomingWhatsAppMessage`)
in `src/app/api/webhooks/whatsapp/__tests__/route.test.ts`.

## Webhook performance

The webhook loops over inbound messages, claiming and processing each
in turn, then returns. Per message this is: one session doc read, one
resident-directory fetch (only once per conversation — cached on the
session via `customerType`/`customerId` after the first message), one
eligible-drivers query (small, indexed, bounded — same query the web
resident/dispatcher forms already run on every page load), zero or one
domain writes, one session doc write, and one or more outbound Meta API
calls. No large Firestore scans, no queue — see DEVIN.md "Do Not
Overbuild".

## Firestore collections/rules

`whatsappSessions/{id}` and `whatsappProcessedMessages/{id}` are
written/read only by these server-only modules via the Admin SDK, which
bypasses Firestore Security Rules entirely. Both collections are fully
`allow read, write: if false` in `firestore.rules` — no client
(resident, driver, staff, or viewer) has any direct access; there is no
operational reason for a human to browse either collection directly. No
new composite indexes were needed — both collections are only ever
accessed by direct document ID lookup (session ID = SHA-256 of the
normalized phone; processed-message ID = SHA-256 of Meta's message ID),
never a query.

## Request source and statistics

`WaterRequestSource` gained `"whatsapp"` alongside `"resident"` /
`"dispatcher"`. In `createWaterRequest()`, every branch that
distinguishes actor type already checked specifically for
`source === "dispatcher"` (staff-on-behalf-of-customer) with a single
generic "else" branch for the customer's own action — `"whatsapp"`
falls into that same "else" branch as `"resident"` with **zero code
changes** to `createWaterRequest()` itself: `createdBy` stays `null`,
the audit event stays the existing `request_created` (not
`request_created_by_dispatcher`), and `actorRole` stays `"resident"`.
This was a deliberate decision, not an oversight — a WhatsApp
submission is self-service by the customer, exactly like a web
submission, just over a different channel, so it did not warrant a
third audit-event type. `src/lib/domain/statistics.ts`'s
`SummaryMetrics.bySource` gained a `whatsapp` count alongside
`resident`/`dispatcher`, shown on `/statistics`. The dispatcher request
detail page (`src/app/dispatcher/[requestId]/page.tsx`) shows
"Submitted via WhatsApp" for `source === "whatsapp"`.

## Testing

`processMessage()`, `parsing.ts`, `phoneMatching.ts`, and
`clientConfig.ts` are pure and fully unit tested without mocking
Firestore, Meta, or crypto — see
`src/lib/whatsapp/__tests__/{conversationSteps,parsing,phoneMatching,clientConfig}.test.ts`.
Webhook signature verification, the verify-token handshake, and
duplicate-message-ID idempotency are tested at the route level
(`src/app/api/webhooks/whatsapp/__tests__/route.test.ts`) by mocking
only `claimMessageId`/`handleIncomingWhatsAppMessage`, while reusing the
REAL pure `clientConfig.ts` functions for signature verification (see
that test file's `vi.mock("@/lib/whatsapp/client", ...)` — it
re-exports the actual pure implementation rather than faking it). The
`server-only`-guarded orchestrator (`handleIncomingMessage.ts`) and
Firestore-backed `session.ts`/`idempotency.ts` are not directly unit
tested (no Firestore emulator in this project's test setup) — same
precedent as `generateContinuityReportData()` — but their logic is
intentionally thin glue around already-tested pure functions and
already-tested canonical domain functions.

## Future WhatsApp Integration (driver side — not built)

Driver WhatsApp commands remain a future phase, not started:

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

Do not implement these until explicitly requested. As with resident
ordering, they must call the exact same domain functions as the driver
web portal (`getNextOfferForDriver`, `acceptDriverOffer`,
`declineDriverOffer`, `markWaterDelivered`, etc.) — never a parallel
implementation. Continue to never store authoritative application state
inside a WhatsApp conversation session; `whatsappSessions` remains
conversation scratch state only.

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
- Driver-side WhatsApp integration (resident WhatsApp ordering is
  implemented — see "WhatsApp Resident Ordering" above)
- Automated billing-based driver access restriction

Build the underlying architecture so reasonable future additions remain possible without prematurely implementing them.