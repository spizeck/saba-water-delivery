# Data Model

This is the canonical Firestore schema as implemented today. It reflects
`src/lib/domain/types.ts` and the domain modules under `src/lib/domain/`.
For the full field-level reference with type definitions, see
[`TECHNICAL.md`](../TECHNICAL.md) "Suggested Firestore Model". This
document explains purpose, relationships, and lifecycle at a glance.

Firestore is the application's single source of truth. There is no
separate analytics database or ETL pipeline.

## `users/{uid}`

**Purpose:** one document per authenticated account (resident, driver,
dispatcher, admin, viewer — a user can hold multiple roles at once).

**Key fields:** `displayName`, `email`, `phone`, `village`
(canonical Saba village values only — see `src/lib/domain/villages.ts`;
noncanonical values are treated as incomplete and force a profile
review), `deliveryDirections`, `roles` (array),
`deliveryProfileConfirmedAt` (last time the resident confirmed their
delivery info was current),
`createdAt`, `updatedAt`.

**Reads:** the owning user; dispatcher/admin (operational support).
**Writes:** only through Admin SDK domain code
(`src/lib/domain/users.ts`); Firestore rules additionally allow a
client to create only its own document with `roles: ["resident"]` and
never permit a client write to change `roles`.

**Lifecycle:** created on first sign-in with `roles: ["resident"]`;
never overwritten on later sign-ins. `deliveryProfileConfirmedAt` is
missing on documents created before that field existed and is treated
as "never confirmed," not backfilled.

### `users/{uid}/roleEvents/{eventId}`

Audit trail of role grants/removals (`role_added` / `role_removed`,
actor, timestamp). Admin-only, written by Admin SDK code.

### `users/{uid}/propertyPhotos/{photoId}` — planned, not implemented

A TypeScript interface and Firestore/Storage security-rule scaffolding
exist for this collection (type, `storagePath` in Firebase Storage,
uploader, timestamps), but there is no domain logic, server action, or
UI that reads or writes it today. Nothing in the running application
creates, lists, or displays a property photo. Treat this as reserved
schema for a planned feature (see `PRODUCT.md` "Property Photos"), not
as working functionality.

## `driverRegistry/{driverId}`

**Purpose:** the government-managed roster of drivers. A registry entry
is independent of any user account and can exist before a driver ever
signs in. See [`ADMIN_GUIDE.md`](./ADMIN_GUIDE.md) for how staff manage
this.

**Key fields:** `displayName`, `phone`, `linkedUserId` (the Firebase
uid of the linked account, or `null`), `eligibilityStatus`
(`eligible`/`ineligible`), `availabilityStatus` (`online`/`offline`),
`cooldownUntil`, `activeRequestId` (the one claimed request this
driver currently holds, or `null` — see "The `activeRequestId` lock"
in `TECHNICAL.md`), audit fields.

**Reads:** dispatcher, admin, viewer. **Writes:** only through
`src/lib/domain/driverRegistry.ts` (Admin SDK) — never a direct client
write, never self-service.

**Relationships:** `linkedUserId` is the bridge between the registry
entry (a government concept) and the Firebase uid used throughout
`waterRequests`/`driverOffers` (an authentication concept). See
"Canonical Driver ID" in `TECHNICAL.md` for why these are kept
separate and why operational code always looks up a registry entry by
`linkedUserId`, never by the registry document ID.

### `driverRegistry/{driverId}/events/{eventId}`

Audit trail: online/offline, access restricted/restored, cooldown
started, registry created/updated, account linked/unlinked, meter
assignment changes.

### `driverRegistry/{driverId}/meters/{stationId}`

One document per fill station the driver has a meter assignment at
(`meterCode`, `meterNumber`).

## `fillStations/{stationId}`

Reference data for the three government fill stations (`bottom`,
`wws`, `hells-gate`). Readable by any signed-in user; not writable by
clients.

## `waterRequests/{requestId}`

**Purpose:** the single record for every water request, regardless of
where it originated. This is the operational core of the system.

**Key fields:**

- `customerId` — the requesting resident's uid, or `null` for an
  unregistered/manual customer (see "Registered vs unregistered"
  below).
- `customer` — a snapshot of the customer's name/phone/email/
  registration status **at request creation time**. Display code
  should prefer this over a live profile lookup, since a resident's
  profile may change after the request is made.
- `source` — `"resident"` | `"dispatcher"` | `"whatsapp"` (see
  "Request source" below).
- `createdBy` — the staff uid who created the request, only set when
  `source === "dispatcher"`.
- `loads` — `1` or `2`; the number of 1,000-gallon loads requested in a
  single request.
- `requestNotes` — optional request-specific Notes / Comments, trimmed and
  limited to 1,000 characters; `null` when absent. It is never copied to the
  resident profile.
- `gallons` — derived server-side as `loads * 1000`, so `1000` or
  `2000`. Clients never send an authoritative gallon value.
- `loadCollections` — `WaterLoadCollection[] | null`. One record per
  physical 1,000-gallon load collection event. Array length should match
  `loads` when populated, but this is not enforced at the schema level.
  Each element captures a denormalized snapshot at collection time:
  - `loadNumber` — `1` | `2`; which load this record describes.
  - `collectedAt` — `Timestamp`; when the collection was recorded.
  - `fillStationId` — canonical station ID (e.g. `bottom`, `wws`,
    `hells-gate`).
  - `fillStationName` — snapshot of the station name at collection time.
  - `meterCode` — string station meter code (e.g. `"BTM2"`).
  - `meterNumber` — number (e.g. `2`).
  - `driverId` — Firebase UID of the driver who physically collected
    the water.
  - `recordedBy` — Firebase UID of the actor who recorded the event
    (the driver, or a staff member acting on their behalf).
  - `recordedByRole` — `UserRole` (`"driver"` | `"dispatcher"` |
    `"admin"`).
  - `note` — `string | null`; required for staff recordings and should
    briefly explain why the driver did not record it themselves.

  Meter and station data are captured as denormalized snapshots and are
  never updated retroactively; treat them as historical truth for the
  collection event. Requests created before this feature existed, or
  whose collection was simply never recorded, have `loadCollections: null`.
- `village`, `deliveryDirections` — the delivery location for this
  request (may differ from the resident's saved profile if a
  dispatcher adjusted it for this request only). New and updated
  requests are validated against the canonical village list in
  `src/lib/domain/villages.ts`; unapproved values are rejected.
- `preferredDriverId`, `preferredDriverExpiresAt` — the resident's
  optional preferred-driver hold.
- `assignedDriverId` — set once a driver claims the request.
- `status` — see "Status lifecycle" below.
- `waterSituation` — a snapshot of the resident's reported water
  situation (persons affected, vulnerable circumstances, storage
  capacity, reported urgency, critical explanation) at request time.
  Never re-derived later.
- `attestationAccepted`, `attestationAcceptedAt` — required before a
  request can be created.
- `dispatchPriority`, `priorityRank`, `prioritySource`,
  `priorityReason`, `priorityUpdatedBy`, `priorityUpdatedAt` — the
  operational priority used for dispatch ordering (distinct from the
  resident's own reported urgency).
- `dispatchBatchId`, `batchSequence` — set when this request is
  currently part of a Batch Dispatch run (see "Batch Dispatch" below).
  Both null for the vast majority of requests, which are self-claimed
  or singly assigned as before.
- `dispatchOverrideRank` — null by default; set to `0` by a dispatcher
  escalation so the request sorts ahead within its priority without
  changing `requestedAt`.
- Timestamps: `requestedAt`, `availableAt`, `claimedAt`, `deliveredAt`,
  `confirmedAt`, `createdAt`, `updatedAt`.

**Status lifecycle:** `requested` → `preferred_driver_hold` (if
applicable) → `available` → `claimed` → `delivered` → `confirmed`, with
`disputed` and `cancelled` as exception states. There is no separate
"delivered but unconfirmed" status; see
[`TECHNICAL.md`](../TECHNICAL.md) "Delivery Confirmation Timeout."

**Registered vs unregistered requests:** a registered resident's
request has `customerId` set to their uid. An unregistered/manual
customer (entered by a dispatcher, or matched to no account over
WhatsApp) has `customerId: null` and a required `customer` snapshot.
No Firebase Auth account is created for an unregistered customer.

**Request source:** `resident` (submitted through the web app),
`dispatcher` (created by staff on behalf of a caller/walk-in), or
`whatsapp` (submitted through the resident WhatsApp conversation).
All three enter the identical dispatch, claiming, delivery, and
statistics workflow — `source` exists only to report how requests
arrived, never to branch driver-facing behavior.

**Reads:** the requesting customer, the assigned driver, dispatcher,
admin, viewer. **Writes:** none directly from clients — every
transition (create, claim, deliver, confirm, dispute, cancel,
reassign, priority change) goes through server-side domain functions
in `src/lib/domain/waterRequests.ts` and related modules.

### `waterRequests/{requestId}/events/{eventId}`

Append-only audit trail for the request: creation, preferred-driver
selection/expiration/decline, claim, reassignment, delivery, customer
or staff confirmation, dispute, cancellation, priority changes, and
related system events. Every meaningful state transition is recorded
here with actor, role, and timestamp.

A `delivery_confirmation_email` event records whether the post-delivery
notification was sent, failed, or skipped. The separate deterministic
`deliveryConfirmationEmailClaims/{requestId}` document provides the atomic
local duplicate-send claim.

New event type: `customer_history_linked` — admin-initiated relink of an
unregistered request to a registered user. Records previous/new
`customerId`, the preserved customer snapshot, the acting admin, the
reason, and timestamp.

New event types: `water_collected` — driver-recorded collection of one
1,000-gallon load; `water_collected_by_staff` — dispatcher/admin-recorded
collection on a driver's behalf. Both record the load number, station,
meter, driver, actor, and timestamp details.

### `waterRequests/{requestId}/photos/{photoId}` — planned, not implemented

Same status as `propertyPhotos` above: a type definition and security
rule scaffolding exist for driver-uploaded delivery photos (proof of
delivery, delivery issue, access issue, other), but no domain logic,
server action, or UI implements uploading, listing, or viewing them.
Treat this as reserved schema for a planned feature (see `PRODUCT.md`
"Proof of Delivery"), not as working functionality.

## `deliveryConfirmationEmailClaims/{requestId}`

**Purpose:** server-only idempotency claim for the one delivery-confirmation
email associated with a request. The deterministic document ID is the request
ID. Fields record `status` (`pending`, `sent`, `failed`, or `skipped`), provider
ID, recipient, non-secret error, and timestamps. Clients have no access; only
Admin SDK notification code reads or writes this collection.

## `driverOffers/{offerId}`

**Purpose:** records one instance of a single request being offered to
a single driver, as part of the one-offer-at-a-time dispatch workflow.
Append-only — a decline or expiration is never overwritten, preserving
full offer history for statistics and auditing.

**Key fields:** `requestId`, `driverId`, `offeredAt`, `response`
(`"accepted" | "declined" | "expired" | null`), `respondedAt`.

**Reads:** the offered driver (their own offers), dispatcher, admin.
**Writes:** only through `src/lib/domain/dispatch.ts` /
`driverOffers.ts`.

## `dispatchBatches/{batchId}`

**Purpose:** a Batch Dispatch run — a deliberate dispatcher-controlled
assignment of several loads to one driver at once, printed as a driver
dispatch sheet. This is an exception to the normal one-offer-at-a-time
driver dispatch model, not a replacement for it. See
[`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md) "Batch Dispatch."

**Key fields:** `driverId` (the assigned driver's Firebase uid, same
convention as `waterRequests.assignedDriverId`), `driverDisplayName`
(driver name snapshotted at creation time; null on legacy runs
created before snapshotting was added — fall back to live registry
lookup), `createdBy`, `status` (`"active"` while any current member
load is still `"claimed"`, otherwise `"completed"`),
`originalRequestIds` (the immutable list of request IDs assigned when
the batch was created — historical record only, not the live
membership list), `generatedAt` (last time its PDF was generated or
reprinted).

**Reads:** dispatcher, admin, viewer. **Writes:** only through
`src/lib/domain/dispatchBatches.ts` (Admin SDK).

**Relationships:** a request's CURRENT membership in a batch is
determined by `waterRequests.dispatchBatchId` pointing back at this
document — queried directly, not by trusting `originalRequestIds`. A
request leaves a batch's current membership (its `dispatchBatchId` is
cleared) when reassigned to a different driver or cancelled; it stays
tagged through delivered/confirmed/disputed so the batch remains a
complete, reprintable record.

### `dispatchBatches/{batchId}/events/{eventId}`

Audit trail: batch creation (`dispatch_batch_created`, with the full
original request list), every reprint (`dispatch_batch_reprinted`), and
manual close (`dispatch_batch_closed`).
Per-load events (assignment, removal from the batch, staff delivery
reconciliation) are recorded on the request's own `events`
subcollection instead — see `waterRequests/{requestId}/events` above.

## `config/dispatchSettings`

**Purpose:** admin-editable dispatch-offer policy: `maxDeclinesPerDay`,
`declineCooldownHours`, plus `updatedAt`/`updatedBy`. If this document
does not exist yet, the application falls back to code-level defaults
in `src/lib/domain/config.ts` without writing anything.

**Reads:** dispatcher, admin. **Writes:** admin only, through
`src/lib/domain/dispatchSettings.ts`.

### `config/dispatchSettings/events/{eventId}`

Audit trail of settings changes (old values, new values, actor).

## `whatsappSessions/{sessionId}`

**Purpose:** ephemeral scratch state for an in-progress WhatsApp
conversation (current step, draft answers, matched customer context).
This is never the authoritative water-request record — it exists only
to carry a multi-message conversation forward. Document ID is a
SHA-256 hash of the normalized sender phone number, not the raw phone
number.

**Reads/writes:** the WhatsApp webhook route only, via the Admin SDK.
No client (resident, driver, staff, or viewer) has any direct access —
the collection is fully deny-by-default in `firestore.rules`.

**Lifecycle:** an incomplete conversation expires after 24 hours
(`appConfig.whatsappSessionExpirationHours`); a new inbound message
after expiration starts a fresh conversation.

## `whatsappProcessedMessages/{messageId}`

**Purpose:** an idempotency ledger. Document ID is a SHA-256 hash of
Meta's message ID. Used to atomically claim each inbound WhatsApp
message exactly once (via Firestore's `create()`, which fails if the
document already exists), so a Meta webhook retry can never
double-process a message.

**Reads/writes:** the WhatsApp webhook route only, via the Admin SDK.
Fully deny-by-default in `firestore.rules`, same as `whatsappSessions`.

## `accountMergeEvents/{eventId}`

**Purpose:** immutable audit record of an authenticated account merge.
Stored as a root-level collection so the record survives any later
deletion/update of the involved user documents.

**Fields:**

- `canonicalUserId` — uid of the account that remains.
- `duplicateUserId` — uid of the merged account.
- `actorId` — uid of the admin who performed the merge.
- `createdAt` — ISO timestamp.
- `reason` — free-text admin reason.
- `roleMergePolicy` — `"union"` or `"explicit"`.
- `mergedRoles` — final role array written to the canonical user.
- `duplicateAuthDeleted` — boolean.
- `counts.requestsRelinked` — number of `waterRequests` whose
  `customerId` was relinked.
- `counts.driverRegistryRelinked` — `0` or `1`.
- `error` — non-secret diagnostic if duplicate Auth account deletion
  failed, otherwise `null`.

**Reads/writes:** fully deny-by-default in `firestore.rules`. All access
is through server-side admin operations in `src/lib/domain/identity.ts`.

## Indexes

Composite indexes are defined in `firestore.indexes.json` and support:

- Driver offer history lookups (`driverId` + `response` + `offeredAt`/`respondedAt`).
- Duplicate detection by customer phone (`customer.phone` + `status`).
- A resident's own request history and active-request checks
  (`customerId` + `status`/`requestedAt`/`confirmedAt`).
- Preferred-driver hold expiration scans (`status` + `preferredDriverExpiresAt`).
- Priority-ordered dispatch selection (`status` + `preferredDriverId`/`priorityRank` + `requestedAt`).
- The general outstanding-request queue (`status` + `requestedAt`).
- A batch's current member requests, in run-sheet order (`dispatchBatchId` + `batchSequence`).

`whatsappSessions` and `whatsappProcessedMessages` need no composite
indexes — both are accessed only by direct document ID lookup.
`dispatchBatches` itself needs no composite index either — the batch
list is a single `orderBy("createdAt")`, and Batch Dispatch's eligible-
requests query reuses the existing `status + priorityRank +
requestedAt` index.

Deploy index changes with:

```bash
firebase deploy --only firestore:indexes
```
