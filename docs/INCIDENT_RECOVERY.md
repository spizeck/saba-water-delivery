# Incident Recovery

Concrete procedures for keeping water deliveries moving during an
outage, and for handling a suspected security incident. This document
is written for government operations staff and IT support.

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

If Facebook sign-in is unavailable, residents and staff can still sign
in with Google or email/password, whichever they have set up on their
account. There is no single point of failure for authentication.

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

If deliveries were coordinated manually during an outage (by phone,
radio, or in person), reconcile them in the application once service is
restored. **Marking a request "delivered" is a driver action, not a
general dispatcher/admin action** — dispatcher/admin tools can
reassign, cancel, override priority, and resolve disputes, but there is
no general-purpose dispatcher/admin control that directly sets an
ordinary request to "delivered." Reconciliation therefore depends on
how the request was assigned and whether the delivering driver has an
account in the system:

- **A request that already existed in the system, claimed by a driver
  who has an account (normal assignment):** once the driver is back
  online, have them open their claimed delivery and use "Mark
  Delivered" for the delivery they already completed manually, exactly
  as they would for a normal delivery. This puts the request into the
  correct state and starts the resident's normal 24-hour confirmation
  window (or, for an unregistered customer, allows a dispatcher to use
  "Confirm Delivery" on their behalf once it shows as delivered).
- **A request assigned through Batch Dispatch:** if the driver used the
  app, the same "Mark Delivered" path above applies. If the driver
  could not use the app (exactly the unreliable-phone scenario Batch
  Dispatch is designed for), a dispatcher can open the batch and use
  **Record Delivery (paper reconciliation)** on that specific load
  after verifying with the driver that it was physically delivered —
  see [`DISPATCHER_GUIDE.md`](./DISPATCHER_GUIDE.md) "Batch Dispatch."
  This is the one case where staff CAN directly record a delivery on a
  driver's behalf, and it only applies to batch-assigned loads.
- **A request that already existed in the system but is not
  batch-assigned and cannot be marked delivered by a driver** (for
  example, the assigned driver is unavailable, or the delivery was
  completed by someone without an account): a dispatcher can still
  cancel the request so it does not remain open indefinitely, and
  should record what actually happened outside the system (for
  example, in the reason given for cancellation). This does not
  produce an accurate "delivered/confirmed" record for statistics —
  see the gap noted below.
- **A delivery that was arranged entirely outside the system during the
  outage** (for example, a brand-new request that was never entered
  because the website was down): a dispatcher can enter it as a manual
  request after the fact so the demand is captured, but the same
  limitation applies — there is no dispatcher/admin action to record it
  as already delivered.

Staff can now mark any `claimed` request as delivered, whether or not
it is part of a batch. Use the dispatcher request detail "Mark
Delivered" action (or the batch detail "Mark Delivered" button for a
batch-assigned load). Each records a distinct staff audit event
(`marked_delivered_by_dispatcher` or `marked_delivered_by_dispatcher_batch`)
so it is never misrepresented as the driver's own "Mark Delivered".
From that point the request follows the same `delivered` ->
confirmed/disputed/auto-confirmed workflow as any other delivery.

There is no automated reconciliation feature — this is a manual staff
process using the existing dispatcher and driver tools. Do not assume
any automatic matching or backfilling happens on its own.
