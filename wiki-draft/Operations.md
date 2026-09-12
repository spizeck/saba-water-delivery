# Operations

[Home](Home.md) · Canonical references: [OPERATIONS.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/OPERATIONS.md), [INCIDENT_RECOVERY.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/INCIDENT_RECOVERY.md), [DEPLOYMENT.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/DEPLOYMENT.md)

## A normal day

At the start of the day, review outstanding and aging requests, unconfirmed deliveries, disputes, and drivers who are unavailable or restricted. During the day, keep assignments and physical delivery records current. Before an expected outage, obtain a fresh continuity report and agree how dispatch will coordinate with drivers.

## Health and readiness

| Signal                             | What it tells an operator                              | What it does not prove                                   |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `/api/health`: 200, `ok`           | The application runtime responds.                      | Database, sign-in, email, or full workflow success.      |
| `/api/readiness`: 200, `ready`     | The app's read-only Firestore probe succeeds.          | Auth provider, email, or every business operation works. |
| `/api/readiness`: 503, `not_ready` | The app cannot complete its Firestore readiness check. | That data is lost or that a restore is required.         |

If health responds but readiness repeatedly fails, ask technical support to investigate Firebase/Firestore and its configuration. If health cannot be reached, investigate hosting or connectivity. If both pass but users have problems, investigate the particular action. Resend and WhatsApp do not determine readiness.

These signals support diagnosis; they do not establish production readiness or automatically configure Vercel monitoring. Government monitoring and alert routing remain tracked in [#62](https://github.com/spizeck/saba-water-delivery/issues/62). Release smoke tests remain in [TESTING.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/TESTING.md).

## Collect useful evidence before escalation

- Note the time and timezone, affected portal/action, affected users or scope, and whether the problem repeats.
- Record the deployment URL, safe error message/code, and health/readiness outcomes.
- Capture the HTTP correlation ID from `x-request-id` or the error body's `requestId` when available. Also record the water request ID separately: it identifies the delivery record, not necessarily the failing HTTP call.
- Note the latest successful operation and any known recent deployment or configuration change.
- For missing reports, record the last report received and the result of manual generation/sending.

Technical maintainers search Vercel's structured logs by correlation ID, event name, route, and time. Logs provide diagnostic outcomes; the in-app audit history provides business history. Keep resident details in authorized operational channels. Do not paste credentials, cookies, raw provider payloads, or unnecessary personal information into tickets.

## Continuity and incidents

The **Outstanding Delivery Snapshot** contains outstanding, not-yet-delivered requests, including Delivery Run assignments. **Generate Continuity Report** downloads it; **Send Continuity Report Now** emails it. The repository schedules nightly sending for 8:00 PM Saba time, but operators should verify actual receipt rather than assume the schedule guarantees delivery.

Save or print the latest report where dispatch can reach it during an outage. It is a dated snapshot: coordinate by phone/radio, record work performed after that snapshot, and avoid duplicate assignments. When service returns, reconcile verified collection and delivery through the application. Staff can mark claimed requests delivered after all collections are recorded. The report is **not a backup**.

For an availability outage, use the canonical incident guide. For suspected lost/corrupted data, involve technical support and use [Disaster Recovery](Disaster-Recovery.md). Preserve logs and audit history in a suspected security incident and escalate through the designated government IT channel. The repository does not establish a named on-call contact; confirming that ownership is part of handover.
