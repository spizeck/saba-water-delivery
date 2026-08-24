# External Integrations

Every external service this application depends on, in one place. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for setup steps and environment
variables.

## Firebase

- **Purpose:** authentication, Firestore (the application's source of
  truth for all data), and Firebase Storage (planned use for photo
  uploads).
- **Provider:** Google Firebase.
- **Authentication mechanism:** the client SDK handles resident/staff
  sign-in (Google, Facebook, email/password); the Admin SDK (a service
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

- **Purpose:** sending the continuity-report email (nightly and
  on-demand).
- **Provider:** Resend.
- **Authentication mechanism:** `RESEND_API_KEY`, a server-only secret.
- **Application endpoint:** `src/lib/email/continuityReportEmail.ts`
  calling Resend's `emails.send()`.
- **Required configuration:** `RESEND_API_KEY`,
  `CONTINUITY_REPORT_EMAIL_FROM` (must be on a Resend-verified domain
  for real government use), `CONTINUITY_REPORT_EMAIL_TO`.
- **Failure impact:** the report email is not sent; the error is
  logged and the cron route returns a 502 so failures are visible.
  Nothing else in the application is affected — manual PDF download
  continues to work regardless. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "Resend failure."

## Facebook Login

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
- **Failure impact:** residents cannot order water over WhatsApp; the
  website and manual dispatcher entry remain fully available. See
  [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md) "WhatsApp outage."
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
