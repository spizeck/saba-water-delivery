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

**`mergedIntoUserId` (issue #73):** set **inside the account-merge
transaction** on the merged-away (duplicate) user's document, pointing at the
surviving canonical uid. It is the application-level "this identity is
decommissioned" marker: both authentication boundaries — session creation
(`POST /api/auth/session`) and session-cookie verification
(`getSessionUser()`) — reject the uid while it is set, from the moment the
merge commits and independently of Firebase Auth cleanup state. The document
is otherwise intentionally retained for historical linkage; `null`/absent on
all normal users. A client can never write this field (deny-by-default
rules). See TECHNICAL.md "Authenticated account merge" and
[ADR 0018](./adr/0018-account-merge-auth-reconciliation.md).

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
  escalation to rank it ahead within its priority without changing
  `requestedAt`. Automatic assignment applies that rank only after fetching up to
  100 available requests by priority/age, so it is not a complete-queue
  guarantee; see [assignment selection](../TECHNICAL.md#dispatch-assignment-selection).
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
or staff confirmation, dispute (resident-filed via `customer_disputed`,
or a dispute an unregistered customer reported to staff via
`customer_dispute_recorded_by_staff` — never mislabeled as the
customer's own action), cancellation, priority changes, and
related system events. Every meaningful state transition is recorded
here with actor, role, and timestamp.

Post-delivery notification outcome is no longer recorded as a per-attempt
`delivery_confirmation_email` request event. It now lives in the durable
`notificationOutbox/{id}` document (issue #53 — see below), which is the
authoritative record of the delivery-confirmation notification's state, attempts,
and sanitized failure. The delivery state-transition events themselves
(`marked_delivered`, `marked_delivered_by_dispatcher[_batch]`) are unchanged.

New event type: `customer_history_linked` — admin-initiated relink of an
unregistered request to a registered user. Records previous/new
`customerId`, the preserved customer snapshot, the acting admin, the
reason, and timestamp.

New event types: `water_collected` — driver-recorded collection of one
1,000-gallon load; `water_collected_by_staff` — dispatcher/admin-recorded
collection on a driver's behalf. Both record the load number, station,
meter, driver, actor, and timestamp details.

New event type: `request_cancelled_by_resident` — resident self-service
cancellation of their own pre-dispatch request (issue #23). Deliberately
distinct from `request_cancelled` (the staff action); records the
resident's uid, role, `previousStatus`, and timestamp — no free-text
reason, no additional PII. See
[`TECHNICAL.md`](../TECHNICAL.md) "Resident Self-Service Cancellation."

### `waterRequests/{requestId}/photos/{photoId}` — planned, not implemented

Same status as `propertyPhotos` above: a type definition and security
rule scaffolding exist for driver-uploaded delivery photos (proof of
delivery, delivery issue, access issue, other), but no domain logic,
server action, or UI implements uploading, listing, or viewing them.
Treat this as reserved schema for a planned feature (see `PRODUCT.md`
"Proof of Delivery"), not as working functionality.

## `notificationOutbox/{id}`

**Purpose:** durable, retriable outbox for important transactional notifications
(issue #53; [ADR 0017](./adr/0017-notification-outbox-and-retry.md)). Today the
only type is delivery-confirmation email. The deterministic document id is
`{type}__{requestId}` (e.g. `delivery_confirmation_email__<requestId>`), so one
logical notification maps to exactly one document across retries.

Created **inside the delivery transaction** for a registered requestor
(`customerId` present), so the notification obligation commits atomically with
the delivery. Processed asynchronously by the protected worker cron
(`/api/cron/notifications`), never inside that transaction. Clients have no
access (deny-by-default); only Admin SDK code reads or writes it, and operator
visibility/manual retry go through admin-only server-authorized domain code.

**Privacy:** stores only stable references and non-PII state — never the
recipient email, message body, delivery directions, confirmation token, or any
secret. Recipient/content are recomputed from the referenced request/profile at
send time.

Fields:

- `type` — notification kind (`delivery_confirmation_email`).
- `requestId` — opaque water-request id (the notification's subject).
- `customerId` — opaque resident uid (recipient reference; recomputed to an email
  at send time).
- `providerIdempotencyKey` — deterministic Resend idempotency key
  (`delivery-confirmation-{requestId}`), reused on every attempt.
- `state` — `pending` | `processing` | `sent` | `failed`.
- `attemptCount`, `nextAttemptAt`, `lastAttemptAt`, `sentAt`.
- `providerMessageId` — Resend message id on success (nullable).
- `failureCategory` / `failureReason` — sanitized category/code only, never a
  provider body.
- `leaseOwner` / `leaseExpiresAt` — worker lease for concurrency control.
- `createdAt`, `updatedAt`.

## `deliveryConfirmationEmailClaims/{requestId}` — legacy, superseded

**Superseded by `notificationOutbox` (issue #53).** This server-only collection
was the pre-outbox "send at most once" claim (deterministic per-request id, with
`status`/provider id/recipient/error/timestamps). No current code reads or writes
it. Historical documents are inert and intentionally not migrated — they live in
a different collection and cannot suppress a new outbox retry. Clients never had
access. New delivery-confirmation notifications use `notificationOutbox` instead.

## `driverOffers/{offerId}`

**Purpose:** an append-only dispatch-decision ledger — each document
records one resolved dispatch decision about a request/driver pair:
`"assigned"` (automatic assignment committed atomically with the
request claim), `"declined"` (the driver explicitly released an
assigned delivery), `"expired"` (a legacy pending offer or
superseded assignment retired), or `"accepted"` (legacy-only, from the
pre-#123 explicit-accept workflow). Current code never creates a
`null` (pending) response — pending documents in production are legacy
records that are expired opportunistically during assignment passes.
The name `driverOffers` is retained for compatibility; new records are
dispatch decisions, not pending offers.

**Key fields:** `requestId`, `driverId`, `offeredAt`, `response`
(`"assigned" | "declined" | "expired" | "accepted" | null`),
`respondedAt` (always set — every current record is created resolved).

**Reads:** the driver (their own records), dispatcher, admin.
**Writes:** only through `src/lib/domain/dispatch.ts` /
`driverOffers.ts`.

## `dispatchBatches/{batchId}`

**Purpose:** a Batch Dispatch run — a deliberate dispatcher-controlled
assignment of several loads to one driver at once, printed as a driver
dispatch sheet. This is an exception to the normal one-assignment-at-a-time
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

**Purpose:** admin-editable dispatch-decline policy: `maxDeclinesPerDay`,
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
- `duplicateAdminRevoked` — boolean: whether the `admin` role was revoked
  from the decommissioned duplicate user document as part of the merge (the
  duplicate's Auth identity is deleted, so a login-less account must not
  remain counted as an administrator — see the last-admin invariant in ADR
  0005 / TECHNICAL.md "Admin role safety"). Absent on records written before
  this was tracked; treat missing as `false`.
- `counts.requestsRelinked` — number of `waterRequests` whose
  `customerId` was relinked.
- `counts.driverRegistryRelinked` — `0` or `1`.
- `error` — sanitized failure category of the most recent reconciliation
  outcome (a `MergeAuthFailureCategory` value), or `null`. Retained for
  backwards compatibility with records written before `authReconciliation`
  existed.
- `authReconciliation` — durable Auth-reconciliation sub-record (issue #73),
  written **inside the merge transaction** so the cleanup obligation is
  durable from commit time. Absent on events created before this mechanism;
  the sweep treats a missing sub-record plus `duplicateAuthDeleted === false`
  as unresolved legacy work and backfills it on first claim. Fields:
  - `state` — `"pending" | "processing" | "reconciled" | "failed"`. Terminal
    states are `reconciled` (the merged-away Auth identity no longer exists)
    and `failed` (terminal for *automatic* retry; remains operator-visible
    and manually retryable).
  - `attemptCount` — completed claim→outcome cycles.
  - `nextAttemptAt` — earliest time the work may be claimed again (backoff
    lower bound); `null` when terminal.
  - `lastAttemptAt` — timestamp of the last completed attempt.
  - `lastFailureCategory` — sanitized failure classification
    (`transient | permission | configuration | invalid_record |
    max_attempts`); never a raw provider error.
  - `duplicateDisabled` — best-effort note that the merged-away Auth identity
    was observed disabled; `false` is not a guarantee — the
    `mergedIntoUserId` application rejection is the authoritative interim
    control.
  - `reconciledAt` — when the identity was confirmed absent/deleted.
  - `leaseOwner` / `leaseExpiresAt` — internal lease coordination for the
    worker claim (see ADR 0018); `leaseOwner` is never exposed through the
    public/operator surface.

**Reads/writes:** fully deny-by-default in `firestore.rules`. All access
is through server-side admin operations in `src/lib/domain/identity.ts` and
`src/lib/domain/mergeReconciliation.ts`.

## `systemInvariants/adminRole`

**Purpose:** a server-only singleton that makes the last-admin invariant
concurrency-safe across **every supported admin-reducing mutation** (issue
#48 for `removeRole`; issue #70 for an admin-demoting `mergeUserAccounts`).
It holds no authoritative state of its own; it exists so that every
admin-reducing mutation reads and writes **one shared document** inside its
transaction, giving Firestore a single point of contention that serializes
those mutations against one another. Two operations that would each remove
an admin therefore cannot both commit — the losing transaction is retried
and, re-reading the now-smaller admin set, fails with `LAST_ADMIN`. See
TECHNICAL.md "Admin role safety" and ADR 0005.

**Fields:**

- `revision` — integer bumped on each admin-reducing mutation (the write
  that creates contention).
- `adminCount` — the live admin count after the last mutation, recomputed
  from the `users` query every time. Observability metadata only; the guard
  never trusts it as the source of truth, so it is self-healing and cannot
  drift.
- `updatedAt` — timestamp of the last admin-reducing mutation.
- `updatedBy` — actor uid of the last admin-reducing mutation.

**Lifecycle:** created lazily on the first admin-reducing mutation — no
migration or backfill. Mutations that cannot reduce the admin count never
touch it.

**Reads/writes:** fully deny-by-default in `firestore.rules`. All access is
through the shared invariant helpers in `src/lib/domain/admin.ts`
(`readAdminPopulationInTransaction` / `recordAdminInvariantParticipation`),
called by `removeRole` and by `mergeUserAccounts`
(`src/lib/domain/identity.ts`) via the Admin SDK. Because the Admin SDK
bypasses rules, the transaction — not the rules — is the concurrency
guarantee; the rule is defense in depth.

## `cronHeartbeats/{cronName}`

**Purpose:** scheduled-operation heartbeat records (issue #62;
[ADR 0020](./adr/0020-scheduled-operation-heartbeat-monitoring.md)). One
document per registered cron (`continuity-report`, `notifications`,
`merge-auth-reconciliation`) so a scheduled job that is **never invoked**
— which otherwise emits no error anywhere — becomes detectable as
staleness. Written only by trusted cron route code via the Admin SDK;
surfaced read-only on `/admin/notifications` and by
`npm run check:heartbeats`. Monitoring metadata only — no business data,
no PII, no request contents.

**Fields:**

- `cron` — the registered cron name (same as the document id).
- `lastAttemptAt` — timestamp of the most recent completed invocation.
- `lastSuccessAt` — timestamp of the most recent **successful** run; absent
  until the first success (a doc without it reads as stale).
- `lastStatus` — `"success"` | `"failure"` of the most recent run.
- `consecutiveFailures` — reset to `0` on success, incremented on failure.
- `lastStaleAlertAt` — when the watchdog last emitted `cron.heartbeat.stale`
  for this cron; deduplicates re-alerts (≤ every 4h while stale).
- `updatedAt` — last heartbeat write.

**Lifecycle:** created lazily on the first cron invocation after deploy — no
migration. Until then the cron reports "never recorded"/stale on the admin
card and the checker, which is the intended pre-first-run signal.

**Reads/writes:** deny-by-default in `firestore.rules` (Admin SDK only).
Writes are `set(..., { merge: true })` from `recordCronHeartbeat` in
`src/lib/monitoring/cronHeartbeat.ts`; reads come from the watchdog, the
admin page, and the checker script. Staleness thresholds live in
`CRON_EXPECTATIONS` in that module (mirrored in
`scripts/check-cron-heartbeats.mjs`).

## Indexes

Composite indexes are defined in `firestore.indexes.json`, the repository
source of truth. The canonical inventory mapping every production query
shape to its required index is `src/lib/firebase/indexContract.ts`
(enforced by a contract test — see `docs/DEPLOYMENT.md` "Firestore index
contract" and `docs/TESTING.md`).

The manifest supports:

- Driver dispatch-decision lookups (`driverId` + `response` + `offeredAt`
  descending for the legacy pending-offer expiry scan; `driverId` + `response` +
  `respondedAt` in **both** directions — descending for decline history,
  ascending for the decline-count queries whose `respondedAt >=` range
  has no explicit `orderBy` and so implicitly orders ascending).
- Duplicate detection by customer phone (`customer.phone` + `status` —
  deployed and retained for parity, though the equality-only query is
  served by merged single-field indexes).
- A resident's own request history and active-request checks
  (`customerId` + `status`/`requestedAt`/`confirmedAt`).
- Preferred-driver hold expiration scans (`status` + `preferredDriverExpiresAt`).
- Priority-ordered dispatch selection (`status` + `preferredDriverId`/`dispatchPriority` + `requestedAt`; the override-ranked candidate stream additionally uses `dispatchPriority` + `dispatchOverrideRank` + `requestedAt`, and the missing-ordering-field catch-all scans by document ID — see TECHNICAL.md "Canonical candidate scan").
- The general outstanding-request queue (`status` + `requestedAt`).
- Notification outbox worker queries (issue #53): due pending notifications
  (`state` + `nextAttemptAt` + `createdAt`) and expired processing leases to
  reclaim (`state` + `leaseExpiresAt`); plus the admin failed-notification
  listing, newest first (`state` + `createdAt` descending).
- Account-merge Auth reconciliation (issue #73): due pending events
  (`authReconciliation.state` + `authReconciliation.nextAttemptAt`),
  expired processing leases (`authReconciliation.state` +
  `authReconciliation.leaseExpiresAt` — also serves the overview's
  equality-plus-range counts, which implicitly order by the range field),
  and unresolved events oldest-first (`duplicateAuthDeleted` +
  `createdAt`).

A few deployed indexes are retained for parity even though no current
query requires them — they are enumerated with reasons in
`RETAINED_INDEXES` in `indexContract.ts`. Removing them from the manifest
would delete them in production on the next index deploy, so removal is
a deliberate cleanup decision, not part of routine maintenance.

`whatsappSessions` and `whatsappProcessedMessages` need no composite
indexes — both are accessed only by direct document ID lookup.
`dispatchBatches` itself needs no composite index either — the batch
list is a single `orderBy("createdAt")`, and Batch Dispatch's eligible-
requests query reuses the existing `status + priorityRank +
requestedAt` index. The deployed `waterRequests` `dispatchBatchId +
batchSequence` composite is retained but unused: `getRequestsForDispatchBatch()`
deliberately fetches by `dispatchBatchId` alone and sorts in memory.

Deploy index changes with:

```bash
firebase deploy --only firestore:indexes
```
