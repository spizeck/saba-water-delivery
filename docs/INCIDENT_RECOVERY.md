# Incident Recovery

Concrete procedures for keeping water deliveries moving during an
outage, and for handling a suspected security incident. This document
is written for government operations staff and IT support.

> **Scope.** This document is about **availability** — keeping deliveries
> moving when the website, Firebase, Vercel, or WhatsApp is down, and
> handling a suspected security incident. It is **not** about backing up or
> restoring data. If an incident involves **lost, deleted, or corrupted
> data** (a bad deployment that wrote wrong data, accidental
> deletion, a botched migration, or a full database restore), use
> [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — the canonical backup and
> data-recovery runbook — instead of, or in addition to, this document.
>
> **How you find out something is wrong:** the monitoring signals, alert
> matrix, and escalation expectations are in
> [`OPERATIONS.md`](./OPERATIONS.md) "Production monitoring and alerting" —
> including the `cron.heartbeat.stale` signal for a scheduled job that never
> ran and the `/admin/notifications` "Scheduled jobs" view.

## Website unavailable

If the website cannot be reached at all:

1. Locate the most recent Outstanding Delivery Snapshot PDF. One is
   emailed automatically every night at 8:00 PM Saba time to the
   configured government recipients, and staff can generate one on
   demand at any time while the site is working (see
   [`OPERATIONS.md`](./OPERATIONS.md)).
2. Use the PDF to see every request not yet delivered — who requested
   it, where, when, and (for claimed requests) which driver has it.
3. Continue coordinating deliveries by phone/radio using this list
   until the website is restored.
4. Once the website is back, follow "Recovery" below to reconcile any
   deliveries that were completed manually during the outage.

## Internet outage

The continuity report is designed exactly for this situation: it gives
staff and drivers a usable, self-contained record of outstanding
deliveries that does not require ongoing internet access. Print or save
the most recent PDF where dispatch staff can access it even without
connectivity.

## Firebase outage

Firebase (Authentication and Firestore) is required for sign-in, and
for any request creation, claiming, or status change. **WhatsApp
ordering is not an independent channel during a Firebase outage** — it
is a front end to the same Firestore-backed system: every inbound
WhatsApp message is first recorded in Firestore before it is even
processed, and every request it creates or updates is the same
Firestore data the website uses. If Firebase is degraded or
unavailable:

- Residents cannot sign in, submit new requests, or confirm/dispute
  deliveries through the website, and the WhatsApp conversation cannot
  progress either — a resident may still be able to send a WhatsApp
  message, but the system cannot record or act on it until Firestore
  recovers.
- Drivers cannot receive new offers or mark deliveries complete.
- Use the most recent continuity report to keep delivering water
  manually until service is restored.
- No application data is at risk of being lost by a Firebase outage
  itself — Firestore is the durable source of truth; an outage affects
  availability, not stored data.

## Vercel outage

Vercel hosts the entire application, including both the resident-facing
website and the WhatsApp webhook endpoint, as one deployment. If Vercel
is degraded or unavailable, both are unreachable together — this is not
a case where WhatsApp can act as a backup for the website, since they
run on the same infrastructure. Firestore data itself is unaffected,
but nothing can reach it until Vercel recovers.

## WhatsApp outage

WhatsApp ordering is a future resident feature. This section describes a
scenario after activation, not a current public service. Its shared Firebase
and Vercel dependencies exist in code; provider configuration/activation must
be verified separately. See [INTEGRATIONS.md](./INTEGRATIONS.md).

If specifically the WhatsApp side is affected — a Meta-side outage, an
expired access token, or a webhook misconfiguration — while the website
and Firebase remain healthy, residents can still request and manage
water through the website, or by calling/visiting the Water Delivery
Office so a dispatcher can enter the request manually. No dispatch or
delivery functionality depends on WhatsApp being available. This is the
one outage scenario where WhatsApp is the affected channel and the
website is not — see "Firebase outage" and "Vercel outage" above for
why the reverse (website down, WhatsApp still working) is generally
not true for this application, since both depend on the same hosting
and the same Firestore data.

## Resend (email) failure

If the continuity report email fails to send (see
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for how this is detected), the
website and dispatch system continue operating normally — email
delivery of the report is not required for the rest of the system to
function. Staff can still generate and download the report manually
from the dispatcher dashboard ("Generate Continuity Report") at any
time, and can retry sending it with "Send Continuity Report Now" once
the issue is resolved.

## Meta/Facebook Login outage

Facebook Login is currently shown as **Coming Soon** on the login page
while Meta business verification is pending. No OAuth attempt is
possible from that button. Provider scaffolding is preserved, but the button
is hard-disabled in `src/app/login/LoginForm.tsx`: enabling it requires a
reviewed application change as well as provider verification/configuration.

If Facebook sign-in is enabled and later becomes unavailable, residents
and staff can still sign in with Google or email/password, whichever
they have set up on their account. There is no single point of failure
for authentication.

## Stale driver activeRequestId

If a driver's `activeRequestId` points to a request that no longer
exists (deleted prelaunch data), or to a request that has been
delivered, cancelled, confirmed, or reassigned to another driver, the
lock is stale and would permanently block the driver from receiving new
offers or being assigned by a dispatcher.

**Runtime self-healing:** The application automatically detects and
clears stale locks before rendering the driver portal, selecting an
offer, accepting a delivery, and processing a dispatcher assignment.
When a stale lock is cleared, a `stale_active_request_cleared` event is
recorded on the driver registry with the stale request ID and reason.

**Read-only check first:** to see whether any stale locks (or other
cross-document inconsistencies) currently exist without changing anything, run
the read-only integrity diagnostic (see
[`OPERATIONS.md`](./OPERATIONS.md) "Checking data integrity"); a stale lock shows
as a `stale_driver_lock.*` finding with the opaque driver/request ids.

**Manual diagnostic:** For bulk prelaunch cleanup, run:

```
node --env-file=.env.local scripts/reconcile-stale-driver-locks.mjs          # dry run
node --env-file=.env.local scripts/reconcile-stale-driver-locks.mjs --write  # apply
```

No staff action is required — the system repairs itself transparently.

## Accidental data loss or corruption

If data has been **deleted, overwritten, or corrupted** (a bad deployment
wrote wrong values, a collection or documents were deleted, a migration
went wrong), this is a **data-recovery** situation, not an availability
outage. To scope suspected corruption without changing anything, first run the
read-only integrity diagnostic (see [`OPERATIONS.md`](./OPERATIONS.md) "Checking
data integrity"); it reports cross-document inconsistencies by severity using
opaque IDs and never writes. Do not improvise. Follow
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md), which covers triaging the
scope, preserving the current (damaged) state before doing anything,
choosing a restore point (point-in-time recovery or a scheduled backup),
restoring into a **separate** database first, validating with the read-only
recovery validator, and only then switching service. A single stale driver
lock or one bad request is a **targeted repair**, not a restore — see the
"Stale driver activeRequestId" section above and `DISASTER_RECOVERY.md`
§"Recovery modes".

## Suspected security incident

1. Stop sharing any credentials that may be compromised (passwords,
   API keys, service account keys) immediately.
2. Preserve logs and evidence — do not delete Firestore audit events,
   role-change history, or driver-registry history, even if they look
   related to the incident. This history is often the only way to
   reconstruct what happened.
3. Contact government IT/security (see your organization's designated
   contact — no specific contact is established in this document;
   escalate through your normal government IT channel).
4. Rotate any credential that may have been exposed: Firebase Admin
   service account key, `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `CRON_SECRET`. See
   [`DEPLOYMENT.md`](./DEPLOYMENT.md) for where each is configured.
5. Do not casually delete audit data (role events, request events,
   driver registry events) as part of cleanup — preserve it for
   investigation, even after the incident is resolved.

## Recovery: reconciling manually handled deliveries

If deliveries were coordinated manually during an outage, reconcile verified
work through the application once service returns. Drivers can record their
claimed deliveries; dispatchers/admins can also use **Mark Delivered** on any
claimed request, including ordinary assignments and Delivery Run members.

Record all load collections first. Staff collection entries require a
verification note. Mark delivered only after verifying the full requested
quantity physically reached the customer. Staff-recorded delivery has a
distinct audit event and starts the usual confirmation/dispute workflow.

For an unregistered customer, staff can confirm receipt after delivery is
recorded. Staff cannot yet create that customer's formal dispute; see
[#50](https://github.com/spizeck/saba-water-delivery/issues/50). Do not cancel a
completed delivery merely to clear the queue when the supported delivery
reconciliation path applies.

For requests arranged entirely outside the system, first review the paper
record for duplicates, then enter and assign the request through supported
staff tools before recording collection and delivery. If the actual delivering
person cannot be represented by an eligible linked driver, escalate the record
reconciliation rather than assigning it to an unrelated driver.

There is no automatic matching or backfilling. Use the
[Dispatcher Guide](./DISPATCHER_GUIDE.md) for the screen procedures and retain
the outage record needed to explain after-the-fact entries.
