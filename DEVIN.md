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

## Bundler: webpack, not Turbopack

Next.js 16 defaults `next dev`/`next build` to Turbopack. This project's
`npm run dev` / `npm run build` scripts explicitly pass `--webpack`
because Turbopack cannot currently bundle `fontkit` (a transitive
dependency of `pdfkit`, used by the continuity report PDF — see
TECHNICAL.md "Operational Continuity Snapshot"): it fails with `Export
applyDecoratedDescriptor doesn't exist in target module` from
`@swc/helpers`. Do not remove `--webpack` from these scripts, and do not
add a dependency that only works under Turbopack, without first
confirming `npm run build` (the exact command Vercel's deployment runs)
still succeeds.

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

User documents use the canonical `roles` array. The singular `role` field is
not supported.

A **role/portal switcher** appears in the header for multi-role users. It
navigates to the selected portal and stores the preference in a `portal` cookie.
The cookie is a UI convenience — authorization always checks the actual stored
`roles` array server-side.

Authentication and authorization are separate concerns.

Never trust a client-provided role.

Never rely on UI visibility for access control.

## Driver Role vs Eligibility

`roles` includes `"driver"` = user may access driver portal functionality.

Government-managed **Driver Registry** eligibility
(`driverRegistry.eligibilityStatus == "eligible"`, looked up by
`linkedUserId`) = government has authorized that driver to claim
deliveries. See "Driver Registry" below — a driver record can exist
before any account exists at all, and getting the `driver` role does
NOT by itself create one.

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
getNextOfferForDriver
acceptDriverOffer
declineDriverOffer
confirmDeliveryByStaff
changeRequestPriority
getMostRecentConfirmedRequest
```

Delivery-profile confirmation reminder logic — see PRODUCT.md /
TECHNICAL.md "Delivery Profile Confirmation Reminder":

```text
evaluateDeliveryProfileReminder()  — src/lib/domain/deliveryProfileReminder.ts (pure)
confirmDeliveryProfile()           — src/lib/domain/users.ts (server-only)
```

Dispatch-priority determination is centralized in a small, pure,
documented module (`src/lib/domain/priority.ts`):

```text
determineInitialDispatchPriority
priorityRankFor
isValidDispatchPriority
```

See PRODUCT.md "Water Situation & Request Priority" and TECHNICAL.md
"Priority-Based Dispatch" — this is a deliberately simple, explainable
decision tree, never an opaque score, and dispatcher/admin can always
review and override it.

Driver Registry operations (`src/lib/domain/driverRegistry.ts`):

```text
createDriver
linkDriverAccount
unlinkDriverAccount
restrictDriver
restoreDriver
setAvailabilityByLinkedUser
setMeterAssignment
```

These functions should be reusable later by non-web interfaces such as WhatsApp.

Operational continuity snapshot logic — see PRODUCT.md / TECHNICAL.md
"Operational Continuity Snapshot":

```text
buildContinuityReportData()             — src/lib/domain/continuityReportData.ts (pure)
generateContinuityReportData()          — src/lib/domain/continuityReport.ts (server-only)
continuityReportPdfFilename()           — src/lib/reports/continuityReportFilename.ts (pure)
renderContinuityReportPdf()             — src/lib/reports/continuityReportPdf.ts
parseRecipientList()                    — src/lib/email/continuityReportEmailContent.ts (pure)
getContinuityReportEmailConfig()        — src/lib/email/continuityReportEmailContent.ts (pure)
buildContinuityReportEmailPayload()     — src/lib/email/continuityReportEmailContent.ts (pure)
sendContinuityReportEmail()             — src/lib/email/continuityReportEmail.ts (server-only; Resend)
```

Email is sent via **Resend** (`RESEND_API_KEY`, `CONTINUITY_REPORT_EMAIL_FROM`,
`CONTINUITY_REPORT_EMAIL_TO` — see .env.example), not SMTP.

Invoked by `src/app/api/cron/continuity-report/route.ts` (nightly, 8:00
PM Saba time via Vercel Cron — see `vercel.json`),
`src/app/api/reports/continuity-snapshot/route.ts` (staff-only manual
download, no email), and `sendContinuityReportNow()`
(`src/app/dispatcher/actions.ts`, staff-only manual immediate send) —
all three call the same generation/PDF/email code, never duplicated.

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

The Resident portal periodically reminds a resident to confirm their
delivery information (phone/village/directions) is still correct — see
PRODUCT.md / TECHNICAL.md "Delivery Profile Confirmation Reminder". This
is a data-quality safeguard against failed deliveries, not a login nag:
it is driven by profile completeness and a 45-day-since-last-
meaningful-review window (confirmation, a delivery-relevant profile
edit, or a completed delivery), never by login frequency or account
age. It only appears on `/resident`, never on other portals for a
multi-role user.

## Driver

Optimize for phone use.

Primary driver workflow:

1. Go online.
2. Receive one delivery offer at a time (customer name, village, gallons,
   age, directions).
3. Accept or decline the offer.
4. View customer/location details for an accepted delivery.
5. Deliver water.
6. Mark delivered.
7. Receive the next offer when available.

A driver may have only one active claimed delivery at a time. The system
enforces this server-side: an already-claimed request prevents new offers
and blocks a second claim, even through stale browser tabs or direct
server-action calls. The driver stays online and remains eligible;
accepting a delivery only makes them temporarily unavailable for another
assignment until the current one is marked delivered — at that exact
moment the driver's assignment is complete and they may immediately
receive another offer. The resident's separate 24-hour delivery
confirmation window (see PRODUCT.md / TECHNICAL.md "Delivery
Confirmation Timeout") never delays this — customer confirmation and
driver availability are independent.

Drivers never browse a full list of open requests — see PRODUCT.md /
TECHNICAL.md "Dispatch Offers". Declining too many offers in a day
(admin-configurable, default 3) pauses new offers for a cooldown period
(admin-configurable, default 1 hour) without affecting government
eligibility.

Do not build a complex driver dashboard.

## Dispatcher

Optimize for operational awareness.

A dispatcher should quickly see:

- New/open requests
- Preferred-driver holds
- Claimed requests
- Aging requests
- Delivered requests awaiting customer confirmation
- Disputes
- Ineligible drivers

A dispatcher can also create a request on behalf of a customer who
called or visited the office (`/dispatcher/new`), for either an existing
registered resident (searched by name/phone/email) or an unregistered
customer (name/phone/village/directions, no account created). This
enters the same delivery workflow as any other request — see
PRODUCT.md / TECHNICAL.md "Dispatcher-Created Requests". Keep this entry
flow fast: search/fill → review → create, no multi-step wizard.

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

Dispatch-offer decline policy is centralized similarly, but is admin-
editable at runtime (Firestore `config/dispatchSettings`) rather than a
code constant, since staff need to tune it without a deploy:

```text
maxDeclinesPerDay = 3
declineCooldownHours = 1
```

Code-level defaults live in `appConfig.defaultMaxDeclinesPerDay` /
`defaultDeclineCooldownHours` and are only used as a fallback until an
admin saves settings for the first time. See
`src/lib/domain/dispatchSettings.ts` and TECHNICAL.md "Dispatch Offers".

## Operational timezone

`appConfig.operationalTimezone` (`"America/Puerto_Rico"`) is the single
centralized setting for all Saba-local date/time display and calendar
boundaries. Use `src/lib/utils/datetime.ts` for any new date/time
formatting or calendar-boundary logic — never hard-code a timezone or
manually offset a timestamp elsewhere. See TECHNICAL.md "Saba
Operational Timezone".

---

# WhatsApp

Resident WhatsApp ordering is implemented — see PRODUCT.md /
TECHNICAL.md "WhatsApp Resident Ordering". Driver WhatsApp
functionality (online/offline, offers, ACCEPT/DECLINE, DELIVERED) is
**not** implemented yet — see TECHNICAL.md "Future WhatsApp
Integration (driver side)". Do not start it without being explicitly
asked.

WhatsApp is a front end to the existing application — it calls the same
domain operations used by the web application
(`createWaterRequest`, `confirmWaterDelivery`, `disputeWaterDelivery`,
`updateUserProfile`), never a parallel implementation:

```text
processMessage()                    — src/lib/whatsapp/conversationSteps.ts (pure)
matchResidentByPhoneFromDirectory() — src/lib/whatsapp/phoneMatching.ts (pure)
matchResidentByPhone()              — src/lib/whatsapp/residentMatch.ts (server-only)
getOrCreateSession() / saveSession()— src/lib/whatsapp/session.ts (server-only)
claimMessageId()                    — src/lib/whatsapp/idempotency.ts (server-only)
getWhatsAppClientConfig() / verifyWhatsAppWebhookChallenge() /
  verifyWhatsAppWebhookSignature()  — src/lib/whatsapp/clientConfig.ts (pure)
sendWhatsAppTextMessage()           — src/lib/whatsapp/client.ts (server-only; Meta Graph API)
handleIncomingWhatsAppMessage()     — src/lib/whatsapp/handleIncomingMessage.ts (server-only orchestrator)
```

Invoked by `src/app/api/webhooks/whatsapp/route.ts` (public, but
`X-Hub-Signature-256`-verified rather than `requireRole()`-protected,
since Meta cannot present a Firebase session cookie). Every inbound
message ID is claimed via `claimMessageId()` before any processing —
this is what makes Meta's webhook retries safe (see TECHNICAL.md
"Webhook Idempotency").

No canonical village list/type existed before this feature — see
`src/lib/domain/villages.ts` (`SABA_VILLAGES`) and PRODUCT.md "Village
Selection" for why it was introduced and what it deliberately did NOT
change (the web form/profile still use free-text `village: string`).

`WaterRequestSource` gained `"whatsapp"` (`src/lib/domain/types.ts`) —
see TECHNICAL.md "Request source and statistics" for why this required
no changes to `createWaterRequest()`'s audit-event logic.

---

# Batch Dispatch

Batch Dispatch is implemented — see PRODUCT.md / TECHNICAL.md "Batch
Dispatch". It is a deliberate, dispatcher-controlled EXCEPTION to the
normal one-offer-at-a-time driver dispatch model, used to preassign
several loads to one driver at once — for example, a driver whose
phone/data access is unreliable — with a printable driver dispatch
sheet. It never weakens the normal driver self-claim invariant (one
active claimed delivery per driver). Only `dispatcher`/`admin` staff
can create a batch or change its membership; drivers cannot create
their own batches.

```text
sortForBatchSelection()            — src/lib/domain/dispatchBatchSelection.ts (pure)
validateBatchSelection()           — src/lib/domain/dispatchBatchSelection.ts (pure)
computeDispatchBatchStatus()       — src/lib/domain/dispatchBatchSelection.ts (pure)
createDispatchBatch()              — src/lib/domain/dispatchBatches.ts (server-only)
getDispatchBatch() / getAllDispatchBatches() / recordBatchGenerated()
                                    — src/lib/domain/dispatchBatches.ts (server-only)
getBatchEligibleRequests() / getRequestsForDispatchBatch() /
  recordBatchDeliveryByStaff()     — src/lib/domain/waterRequests.ts
buildDispatchBatchPdfData()        — src/lib/domain/dispatchBatchPdfData.ts (pure)
renderDispatchBatchPdf()           — src/lib/reports/dispatchBatchPdf.ts
```

Do not build route optimization, map routing, GPS tracking, automatic
batch generation, driver-created batches, or a bulk "mark entire batch
delivered" action — see PRODUCT.md/TECHNICAL.md "Batch Dispatch" for
exactly what this feature is (assignment + print support) and is not
(route planning).

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
- **Client-side compression is a hard requirement, not an optimization** —
  government raised cellular-data usage as a launch concern (see
  PRODUCT.md "Photo Cellular-Data Requirements"). Centralize every
  compression parameter (max dimension, format, quality, size limits)
  in `src/lib/domain/photoConfig.ts` (`photoUploadConfig`) rather than
  hard-coding them at upload call sites. Never upload an original
  full-resolution phone photo, and never upload both an original and a
  compressed copy. See TECHNICAL.md "Client-side compression (cellular
  data)" / "Photo Failure Testing Requirements" for the full test list
  to cover before shipping this feature.

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
- Add/remove operational roles (driver, dispatcher, admin, viewer)
- Driver Registry management (`/admin/drivers`) — see below
- Dispatch offer settings: maximum driver declines per day and decline
  cooldown hours (`config/dispatchSettings`, admin-only, audited)
- Role-change audit trail (`users/{uid}/roleEvents` subcollection)

## Key behaviors

- `resident` is the baseline role and cannot be removed.
- Adding `driver` role does NOT create any driver record — operational
  drivers are entered separately in the Driver Registry (see below).
- Removing `driver` role forces the linked Driver Registry entry (if
  any) to unlink and go offline, but preserves all history.
- Admin cannot remove their own `admin` role (self-lockout protection).
- The last system admin cannot be removed (system lockout protection).
- All role mutations happen server-side via Admin SDK.
- Driver role removal is BLOCKED when active claimed deliveries exist.
  The admin must resolve/reassign deliveries through the dispatcher workflow first.

---

# Driver Registry

`/admin/drivers` is the government-managed roster — see PRODUCT.md /
TECHNICAL.md "Driver Registry" for the full model and canonical-ID
rationale. Summary for maintainers:

- A driver can be created here with just a name (+ optional phone) —
  no account required.
- `/admin/drivers/[driverId]` — edit basic info; link/unlink an existing
  user account (search by name/phone/email); restrict/restore
  eligibility; edit fill-station meter assignments; view audit history.
- "Registry Tools" on `/admin/drivers` has one idempotent, explicitly
  admin-triggered action: seed the known initial roster. It does not run
  automatically.
- Operational code (claiming, offer eligibility, resident/dispatcher
  driver pickers, statistics driver attribution) looks up a registry
  entry by `linkedUserId`, never by registry ID — see TECHNICAL.md
  "Canonical Driver ID".

## Domain logic

- `src/lib/domain/driverRegistry.ts` — all registry/linking/eligibility/
  meter/migration logic
- `src/lib/domain/fillStations.ts` — fill-station reference data
- `src/app/admin/drivers/` — list, add-driver form, registry tools
- `src/app/admin/drivers/[driverId]/` — detail page and panels

---

# Viewer Portal

`/viewer` is a strongly read-only oversight page for the `viewer` role
— see PRODUCT.md / TECHNICAL.md "Viewer Role". It is a separate,
minimal page (not a stripped-down copy of the dispatcher dashboard)
because dispatcher's components carry action buttons and richer
customer fields (phone, full directions) that the viewer must not
receive at all; the small amount of table markup duplicated here is
worth avoiding a much larger conditional-rendering surface in the
dispatcher components. `/statistics` is shared as-is between dispatcher,
admin, and viewer, since it's already aggregate-only data.

## Domain logic

- `src/app/viewer/page.tsx` — builds a reduced request/driver
  projection server-side before rendering (see TECHNICAL.md "Privacy-
  by-projection")

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

- **Summary cards:** Total requests, confirmed, awaiting confirmation, disputed, cancelled, gallons.
- **Current operations:** Open requests, aging (>24h, >48h), unresolved disputes, oldest.
- **Average times:** Request→Claim, Request→Delivery, Claim→Delivery, Delivery→Confirm.
- **Request volume:** Bar chart (daily for short periods, monthly for year/all).
- **Village demand:** Table sorted by highest demand, uses request village snapshot.
- **Driver operations:** Table with loads/deliveries/times/status per driver.
- **Preferred driver:** Usage rate, claimed by preferred, expired to queue, comparative timing.
- **Dispatch offers:** Offers sent, accepted, declined, acceptance rate
  (from `driverOffers`).
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

# Dispatcher-Created Requests

`/dispatcher/new` lets dispatcher/admin staff create a water request for
a customer who called or visited the office. See PRODUCT.md and
TECHNICAL.md for the full "Dispatcher-Created Requests" spec — summary
for maintainers:

## Access

- `dispatcher` and `admin` roles only (enforced server-side via
  `requireRole(["dispatcher", "admin"])`, same as the rest of the
  dispatcher portal). Having only the `driver` role does not grant this.

## Two customer paths, one workflow

- **Existing resident:** searched via `getResidentDirectory()`
  (`src/lib/domain/users.ts`), a staff-facing subset of user profiles
  distinct from the admin user list. Village/directions are editable for
  this request only — never written back to the profile.
- **Unregistered customer:** name + phone required, email optional, no
  Firebase Auth account created. `customerId` is stored as `null`.
- Both paths call the same `createWaterRequest()` used by the resident
  portal, with `source: "dispatcher"` and `createdBy: <staff uid>`. There
  is no separate manual queue or duplicated claiming/dispatch logic.

## Duplicate handling

- Registered resident: hard block (existing one-active-request rule),
  surfaced with a link/description of the conflicting request.
- Unregistered customer: soft warning by phone match
  (`findActiveRequestsByPhone()`), with an explicit "this is not a
  duplicate — continue" override that is recorded on the creation event,
  never silently bypassed.

## Staff confirmation

For unregistered customers only, `confirmDeliveryByStaff()` lets staff
operationally confirm a delivered request from the request detail page
(`/dispatcher/[requestId]`, `RequestActions.tsx`), recording
`delivery_confirmed_by_dispatcher` rather than `customer_confirmed`.

## Request attestation

Both resident and dispatcher request forms now require an attestation
checkbox before the final submission. `createWaterRequest()` rejects the
request server-side if `attestationAccepted` is not `true`. The field is
stored on the request along with `attestationAcceptedAt`.

## Domain logic

- `src/lib/domain/waterRequests.ts` — `createWaterRequest()` (extended
  for source/snapshot/duplicate handling), `findActiveRequestsByPhone()`,
  `getActiveCustomerIds()`, `confirmDeliveryByStaff()`
- `src/lib/domain/users.ts` — `getResidentDirectory()`
- `src/app/dispatcher/actions.ts` — `createManualRequest`,
  `confirmUnregisteredDelivery`
- `src/app/dispatcher/new/` — page and form UI

---

# Before Major Changes

Before making a significant architectural decision:

1. Check `PRODUCT.md`.
2. Check `TECHNICAL.md`.
3. Determine whether the decision is already specified.
4. Prefer the simplest approach satisfying the documented requirement.
5. If an important product decision remains ambiguous, flag it rather than inventing complicated behavior.

---

# Public pages and legal

- `/` — public homepage with the PES logo, resident/driver login buttons, Need Help card, and footer.
- `/privacy` — Privacy Policy, marked as a draft pending government approval.
- `/terms` — Terms of Use, marked as a draft pending government approval.
- `/data-deletion` — User Data Deletion instructions, required for the
  Facebook Login / Meta app configuration's "Data Deletion Instructions
  URL" field. Publicly accessible without authentication, like
  `/privacy` and `/terms`. Explains how to request deletion of personal
  data via the Water Delivery Office, the government-record-retention
  qualification, and how removing Facebook authorization is distinct
  from requesting data deletion. Does NOT implement any automatic
  deletion (Firestore, Firebase Auth, or Facebook Graph API) — see
  PRODUCT.md/TECHNICAL.md "Out of Scope" if such automation is ever
  requested later; this page satisfies the "instructions URL"
  requirement, not a machine-to-machine "data deletion callback".
- `Footer` (`src/components/layout/Footer.tsx`) links to Privacy
  Policy, Terms of Use, and Data Deletion, and is shown on public pages
  (`/`, `/login`, `/access-denied`, `/privacy`, `/terms`,
  `/data-deletion`).
- The Water Delivery Office's public WhatsApp contact
  (`waterOfficeContact` in `src/lib/siteContact.ts`) is centralized so
  the homepage, Terms of Use, and Data Deletion page never show
  different numbers.
- Logo appears in `SiteHeader` and `PortalHeader` for authenticated pages.

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