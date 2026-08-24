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
for any request creation, claiming, or status change. If Firebase is
degraded or unavailable:

- Residents cannot sign in, submit new requests, or confirm/dispute
  deliveries through the website or WhatsApp.
- Drivers cannot receive new offers or mark deliveries complete.
- Use the most recent continuity report to keep delivering water
  manually until service is restored.
- No application data is at risk of being lost by a Firebase outage
  itself — Firestore is the durable source of truth; an outage affects
  availability, not stored data.

## Vercel outage

Vercel hosts the application and its scheduled continuity-report cron.
If Vercel is degraded or unavailable, the effect is the same as the
website being unavailable (see above) — Firestore data itself is
unaffected, but the app cannot be reached until Vercel recovers.

## WhatsApp outage

If the WhatsApp ordering channel is down (Meta outage, or a webhook
misconfiguration), residents can still request and manage water
through the website, or by calling/visiting the Water Delivery Office
so a dispatcher can enter the request manually. No dispatch or delivery
functionality depends on WhatsApp being available.

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
restored:

- For a request that already existed in the system before the outage,
  update its status normally through the dispatcher dashboard (mark it
  delivered, confirm it, or cancel it, as appropriate) so the record
  matches what actually happened.
- For a delivery that was arranged entirely outside the system during
  the outage (for example, a brand-new request that was never entered
  because the website was down), a dispatcher should enter it as a
  manual request after the fact so it is captured in the operational
  record and statistics, even though the actual delivery already
  occurred.

There is no automated reconciliation feature — this is a manual staff
process using the existing dispatcher tools. Do not assume any
automatic matching or backfilling happens on its own.
