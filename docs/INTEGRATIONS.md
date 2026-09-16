# External Integrations

Every external service this application depends on, in one place. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for setup steps and environment
variables.

Production accounts, API keys, sending domains, and project memberships
for these services should ultimately be controlled by the Public Entity
Saba or its authorized technical administrators. Until a formal handover
is complete, document who holds each credential so ongoing government
operation does not depend on an individual developer.

## Firebase

**Current availability:** Google and email/password are implemented login
paths. Facebook is scaffolded but disabled in the login UI. Firebase/GCP is
described as developer-owned pilot infrastructure in [#56](https://github.com/spizeck/saba-water-delivery/issues/56);
government ownership has not been established by the existence of this guide.

- **Purpose:** authentication, Firestore (the application's source of
  truth for all data), and Firebase Storage (planned use for photo
  uploads).
- **Provider:** Google Firebase.
- **Authentication mechanism:** the client SDK handles resident/staff
  sign-in (Google and email/password; Facebook is disabled in the UI); the Admin SDK (a service
  account) performs all trusted server-side reads/writes and bypasses
  Firestore Security Rules by design.
- **Application endpoint:** Firebase client SDK
  (`src/lib/firebase/client.ts`) and Admin SDK
  (`src/lib/firebase/admin.ts`).
- **Required configuration:** `NEXT_PUBLIC_FIREBASE_*` (client) and
  `FIREBASE_ADMIN_*` (server) environment variables.
- **Failure impact:** sign-in, request creation/claiming, and any data
  read/write stop working. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Firebase outage."

## Vercel

**Ownership:** [#57](https://github.com/spizeck/saba-water-delivery/issues/57)
tracks transfer from developer-controlled pilot hosting to government control.
The public pilot hostname is not an official government custom domain;
[#59](https://github.com/spizeck/saba-water-delivery/issues/59) tracks that work.

- **Purpose:** hosting the Next.js application and running the nightly
  continuity-report cron job.
- **Provider:** Vercel.
- **Authentication mechanism:** not applicable to the running
  application; Vercel's own dashboard access is separate from this
  application's authentication.
- **Application endpoint:** the deployed application itself, and
  `/api/cron/continuity-report` invoked by Vercel Cron.
- **Required configuration:** `vercel.json` cron schedule; all
  environment variables set in the Vercel dashboard.
- **Failure impact:** the application (and the nightly report) becomes
  unreachable. Firestore data is unaffected. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Vercel outage."

## Resend

**Lifecycle status:** email sending is implemented; [#58](https://github.com/spizeck/saba-water-delivery/issues/58)
describes the configured developer-owned pilot setup. Government account,
sender-domain, and credential ownership remain transition work. This document
does not verify current secret values, provider health, or successful receipt
of each message.

- **Purpose:** sending the continuity-report email (nightly and on-demand),
  account setup invitations, and post-delivery confirmation requests for
  registered residents.
- **Provider:** Resend.
- **Authentication mechanism:** `RESEND_API_KEY`, a server-only secret. In
  deployed Vercel environments it is injected by the Vercel-managed Resend
  integration (Vercel → Integrations → Resend); locally it is a key created
  in the Resend dashboard. The integration also injects
  `RESEND_EMAIL_DOMAIN` (the verified sending domain) — informational only;
  the application deliberately resolves senders from the explicit
  `*_EMAIL_FROM` variables so each identity keeps its display name and
  mailbox.
- **Application endpoint:** modules under `src/lib/email/` call Resend's
  `emails.send()`.
- **Required configuration:** `RESEND_API_KEY`,
  `CONTINUITY_REPORT_EMAIL_FROM` (must be on a Resend-verified domain
  for real government use), `CONTINUITY_REPORT_EMAIL_TO`; optional
  `DELIVERY_CONFIRMATION_EMAIL_FROM` and `ACCOUNT_SETUP_EMAIL_FROM`
  override the shared sender.
- **Failure impact:** continuity-report failures are logged and return 502; the
  report is reconstructible operational reporting and is **not** placed in the
  durable outbox. Account-setup invitations remain best-effort (the admin sees
  the send result synchronously and can re-invite).
- **Delivery-confirmation email is durable (issue #53).** It is delivered from
  the durable notification outbox with automatic bounded retry (see
  [ADR 0017](./adr/0017-notification-outbox-and-retry.md) and
  TECHNICAL.md "Durable notification outbox"): the intent is created inside the
  delivery transaction, sent asynchronously by the protected worker cron, and
  retried on transient provider failure. A notification failure never alters
  delivery status, driver availability, or the 24-hour deadline. Unregistered and
  unclaimed requestors are never sent authenticated confirmation links. Delivery
  is **at-least-once with Resend idempotency-key de-duplication, not
  exactly-once.** If Resend is unconfigured the notification becomes a terminal
  `configuration_disabled` failure (visible to operators, not retried in a loop)
  rather than blocking delivery. Permanently failed notifications are visible and
  manually retriable at `/admin/notifications`. See
  [`OPERATIONS.md`](./OPERATIONS.md) "Notification outbox" and
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Resend failure."

## Facebook Login

**Not enabled for users:** `src/app/login/LoginForm.tsx` renders a disabled
**Coming Soon** button without an OAuth click handler. Provider scaffolding
does not make Facebook available. Enabling it requires a reviewed application
change as well as the provider configuration below.

- **Purpose:** an optional sign-in method for residents and staff.
- **Provider:** Meta, via Firebase Authentication's Facebook provider.
- **Authentication mechanism:** OAuth through Firebase Authentication;
  this application never handles a Facebook access token directly.
- **Application endpoint:** `/login`.
- **Required configuration:** a Meta App with Facebook Login enabled,
  configured as a provider in the Firebase Console. The Meta App's
  Data Deletion Instructions URL should point at `/data-deletion`.
- **Failure impact:** Facebook sign-in is unavailable; Google and
  email/password sign-in continue to work. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Meta/Facebook
  Login outage."

**This is a distinct Meta product from WhatsApp below** — they share a
company but not a configuration, credentials, or purpose.

## WhatsApp Business Platform (Cloud API)

**Future resident feature:** ordering logic, outbound transport, and GET/POST
webhook infrastructure exist in code, but automated ordering is not available
to live residents (project-owner clarification, 12 September 2026). The four
`WHATSAPP_*` values below are expected configuration, not evidence that
production credentials are present. The webhook returns 503 when configuration
is incomplete. Meta number provisioning, webhook subscription, and Live-mode
activation must be verified before launch; this repository review did not
inspect private deployment configuration. The following describes the supported
integration and its future operating requirements, not an active public channel.

- **Purpose:** resident water-request ordering over WhatsApp — a
  front end to the same request system used by the website, not a
  separate one. Driver-side WhatsApp functionality is not implemented.
- **Provider:** Meta, via the WhatsApp Business Platform Cloud API
  (Meta's own Graph API — no third-party WhatsApp provider is used).
- **Authentication mechanism:** outbound calls use
  `WHATSAPP_ACCESS_TOKEN`. Inbound webhook calls are verified using an
  HMAC-SHA256 signature (`X-Hub-Signature-256`) computed with
  `WHATSAPP_APP_SECRET` — there is no Firebase session, since Meta
  cannot present one.
- **Application endpoint:** `/api/webhooks/whatsapp` (`GET` for the
  verification handshake, `POST` for inbound messages).
- **Required configuration:** `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`; the webhook subscribed to the `messages`
  field in the Meta App Dashboard.
- **Failure impact:** if the failure is on the Meta/WhatsApp side only
  (an outage, an expired token, or a webhook misconfiguration),
  residents cannot order water over WhatsApp, but the website and
  manual dispatcher entry remain fully available. This is **not**
  symmetric: WhatsApp cannot act as a backup for a website outage,
  because both the resident-facing website and the WhatsApp webhook run
  as the same Vercel deployment, and both the website and WhatsApp
  message processing depend on the same Firestore database — a
  Firebase outage affects both channels together. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "WhatsApp outage,"
  "Vercel outage," and "Firebase outage."
- **24-hour customer-service messaging window:** Meta only allows
  free-form messages to a resident within 24 hours of their last
  inbound message, which is also why WhatsApp conversation sessions in
  this application expire after 24 hours
  (`appConfig.whatsappSessionExpirationHours`). **Proactive template
  messaging (sending a resident a WhatsApp message they did not
  initiate, such as a delivery notification) is not part of this
  phase** — every message this application sends is a reply within an
  active resident-initiated conversation.
- **Development vs Live mode:** a new Meta App starts in Development
  mode, which can only message phone numbers explicitly added as
  testers using Meta's own test number. Messaging the public
  government number and arbitrary residents requires provisioning that
  number as a real WhatsApp Business number and moving the app to Live
  mode, which requires Meta Business Verification (a manual document
  submission process that can take from a day to a few weeks).
