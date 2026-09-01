# Saba Water Delivery Security Review

Review date: 1 September 2026

## Executive summary

The application uses server-verified Firebase sessions, server-authorized domain operations, deny-by-default Firestore rules, and deny-all Firebase Storage rules. The production-hardening pass removed direct viewer access to raw customer/request data, restricted owner profile updates to an explicit field allowlist, and limited raw request audit visibility to operational staff. The viewer portal continues to work through a trusted Server Component that produces a sanitized projection before rendering.

This report verifies repository configuration and emulator-tested rules. The Firebase and Vercel consoles must still be checked to confirm that deployed settings match the repository.

## Findings and fixes

### High — scheduled report endpoint failed open when its secret was absent

The continuity-report cron route previously accepted public requests when `CRON_SECRET` was not configured.

**Fixed:** the route fails closed with HTTP 503 when configuration is missing and returns HTTP 401 for an incorrect bearer token.

### High — crafted staff registration could assign privileged roles

A manipulated registration action could previously submit privileged roles not displayed by the form.

**Fixed:** action and domain layers permit only resident and driver roles during staff registration.

### Medium — viewer could directly retrieve raw customer PII

The viewer UI displayed a reduced request projection, but Firestore rules allowed a viewer credential to retrieve complete `waterRequests` documents and events.

**Fixed:** viewers have no direct Firestore access to requests, request events, driver registry records, registry events/meters, offers, or delivery-run records. The viewer page authenticates the viewer on the server, reads with Firebase Admin, and renders only status, priority, quantity, village, source, request date, and assignment presence. It does not send customer name, phone, email, directions, vulnerability details, driver contact details, linked account IDs, or raw events to the viewer UI.

### Medium — owner profile updates were future-schema permissive

The previous user update rule protected `roles` but implicitly allowed owners to alter any other current or future field.

**Fixed:** direct owner updates can affect only `displayName`, `phone`, `village`, and `deliveryDirections`. Account status, roles, email, timestamps, confirmation state, registration metadata, and unknown future fields remain server-only. Direct user-document creation is denied because account provisioning already uses trusted server code.

### Medium — raw request audits exposed unnecessary internal details

Residents and assigned drivers could directly retrieve complete request audit documents, including staff corrections, before/after values, assignment history, reasons, and internal identifiers.

**Fixed:** only dispatcher/admin roles may directly read raw request events. Existing resident and driver workflows do not use these documents. Future customer-facing history must use a purpose-built server projection.

### Medium — inactive photo metadata rules were broader than Storage

Firestore photo metadata allowed reads/writes while Firebase Storage denied all binary access and no photo workflow exists.

**Fixed:** property-photo and request-photo metadata are now deny-all until binary access, ownership/assignment checks, and retention are implemented as one reviewed feature.

### Medium — staff collection reconciliation could name a different driver

**Fixed:** collection recording requires the recorded driver to match the request's assigned driver for every acting role.

### Medium — missing baseline browser security headers

**Fixed:** application responses include HSTS, MIME-sniffing protection, clickjacking protection, strict-origin referrer policy, and a restrictive Permissions Policy. A CSP remains future work pending Firebase Authentication and Next.js compatibility testing.

### Moderate dependency advisory

`npm audit --omit=dev` reports transitive `uuid` findings through Firebase Admin's Google Cloud dependencies. No forced downgrade or `npm audit fix --force` was applied. Upgrade Firebase Admin separately after runtime and application compatibility verification.

## Firestore permissions matrix

| Collection | Direct reads | Direct creates/updates/deletes | Application access path |
|---|---|---|---|
| `users` | Owner; dispatcher/admin | Owner update only for four allowlisted profile fields; create/delete denied | Server provisioning, profile confirmation, registration, role management |
| `users/*/roleEvents` | Denied by catch-all | Denied | Admin SDK |
| `users/*/propertyPhotos` | Denied | Denied | Not implemented |
| `driverRegistry` | Dispatcher/admin | Denied | Admin SDK for mutations; viewer receives server projection |
| `driverRegistry/*/events` | Dispatcher/admin | Denied | Admin SDK |
| `driverRegistry/*/meters` | Dispatcher/admin | Denied | Admin SDK |
| `driverRegistryUniqueKeys` | Denied | Denied | Admin SDK transaction only |
| `fillStations` | Any authenticated user | Denied | Reference data; mutations server-only |
| `waterRequests` | Owning resident; assigned driver; dispatcher/admin | Denied | All lifecycle changes use Admin SDK/domain rules |
| `waterRequests/*/events` | Dispatcher/admin | Denied | Admin SDK; no raw resident/driver/viewer access |
| `waterRequests/*/photos` | Denied | Denied | Not implemented |
| `driverOffers` | Dispatcher/admin | Denied | Driver offer UI/actions use trusted server code |
| `config` and events | Dispatcher/admin | Denied | Admin SDK mutations |
| `dispatchBatches` and events | Dispatcher/admin | Denied | Admin SDK; viewer access is projected server-side |
| `whatsappSessions` | Denied | Denied | Webhook/Admin SDK only |
| `whatsappProcessedMessages` | Denied | Denied | Webhook/Admin SDK only |
| `accountMergeEvents` | Denied | Denied | Admin SDK only |
| Unknown collections | Denied | Denied | None |

Document IDs do not grant access. Rules evaluate authenticated ownership, current assignment, or staff role. Queries must include constraints compatible with the document rules; broad resident/driver request queries are rejected rather than filtered.

## Audit integrity

Audit records are preserved unchanged. Audit creation and every operational mutation remain server-only. Staff retain raw operational audit visibility. Residents, drivers, and viewers cannot directly retrieve internal event documents. No historical documents were migrated or deleted.

## Storage verification

No source code imports `firebase/storage` or calls Storage APIs. Current functionality does not depend on Firebase Storage. `storage.rules` continues to deny every read and write for property photos, request photos, and unknown paths. Firestore photo metadata now follows the same deny-all posture.

## Authentication and server authorization

- Firebase ID tokens are verified before an HTTP-only session cookie is issued.
- Session cookies are re-verified with revocation checking and roles are re-read from Firestore.
- Firebase Admin initialization is marked server-only.
- Resident actions bind identity to the session and validate ownership.
- Driver actions bind identity to the session and validate assignment/registry linkage.
- Dispatcher actions require dispatcher or admin on the server.
- Role and registry administration requires admin.
- Direct Firestore writes cannot bypass domain state transitions.

## App Check assessment

### Browser-accessed Firebase resources

The browser directly uses Firebase Authentication. The repository contains no direct browser Firestore or Storage access. Operational data is read and mutated by Server Components, route handlers, or server actions through Firebase Admin.

### What App Check could protect

If direct browser Firestore or Storage access is introduced later, App Check can help reject traffic that does not originate from an attested application instance. It can also add abuse resistance around supported Firebase client services.

### What App Check would not protect

- It does not replace Firebase Authentication or Firestore/Storage Security Rules.
- It does not authorize roles, ownership, or request state transitions.
- Firebase Admin calls bypass App Check and must remain protected by server sessions and authorization.
- It does not protect arbitrary Next.js server actions, Vercel routes, cron endpoints, or the WhatsApp webhook.
- It does not stop an authorized user from abusing permissions they legitimately hold.

### Recommendation

App Check is **future hardening, not a launch blocker** for the current architecture because operational Firestore and Storage access is server-only. Before enabling enforcement, test Firebase Authentication compatibility, preview deployments, local development/debug tokens, automated tests, and incident recovery. Reassess before adding any direct browser Firestore or Storage feature.

## Automated security-rule verification

Firebase Emulator tests cover allowed and forbidden behavior for:

- Signed-out access
- Resident own/other profile reads
- Resident profile allowlist and forbidden privileged/unknown fields
- Own, other, and broad request queries
- Direct request mutations
- Driver assigned/unrelated requests
- Driver access to users, raw events, photos, registry, and offers
- Viewer raw PII/internal-data denial and mutation denial
- Dispatcher/admin operational reads and direct mutation denial
- Driver registry events/meters
- Config and config events
- Delivery runs and events
- WhatsApp and idempotency data
- Account merge events
- Driver uniqueness keys
- Photo metadata
- Fill-station reference reads
- Unknown collection catch-all denial

## Firebase Console handover checklist

Manually verify:

1. Deployed Firestore rules exactly match `firestore.rules` in this release.
2. Deployed Storage rules exactly match the deny-all `storage.rules` file.
3. Authorized Firebase Authentication domains contain only required production/preview domains.
4. Enabled authentication providers match current product requirements.
5. Unused providers are disabled.
6. Service-account IAM permissions follow least privilege.
7. Obsolete service-account keys are revoked and active keys have owners/rotation dates.
8. Privileged human accounts use MFA; enforce organization policy where available.
9. Firestore backup/export schedules are enabled and restoration is tested.
10. Data retention requirements cover requests, audit events, WhatsApp scratch data, and logs.
11. Google Cloud/Firebase administrative and data-access audit logging is enabled and reviewed.
12. App Check remains unenforced unless the compatibility plan above is completed.
13. Alerting covers authentication abuse, denied traffic spikes, webhook failures, and unusual server/API activity.

## Vercel items requiring dashboard verification

The repository cannot verify Firewall/WAF rules, bot protection, rate limiting, Deployment Protection, environment-variable scopes, team MFA/SSO, project role assignments, audit logs, domain certificate health, or branch protections. Vercel normally supplies TLS termination and platform-level DDoS mitigation, but live project and plan settings must be confirmed in the dashboard.

## Data and secrets statement

No production data was modified or deleted during this review. No credentials, tokens, private keys, or sensitive environment values are included in this report.
