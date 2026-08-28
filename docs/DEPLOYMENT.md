# Deployment

How to reproduce and configure the production deployment. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for what each external service
is used for and its failure impact.

## External services

| Service | Purpose |
| --- | --- |
| Vercel | Hosting, serverless functions, and the nightly continuity-report cron. |
| Firebase | Authentication, Firestore (data), Firebase Storage (photos, planned). |
| Resend | Sending the continuity-report email. |
| Meta (Facebook Login) | Optional resident/staff sign-in provider. |
| Meta (WhatsApp Business Platform / Cloud API) | Resident WhatsApp ordering. |
| DNS | A verified sending domain in Resend requires DNS records at your domain registrar; Vercel's default `*.vercel.app` domain requires no DNS setup, a custom domain does. |

Production deployments should use accounts, API keys, sending domains,
and project memberships controlled by the Public Entity Saba or its
authorized technical administrators. Avoid relying on personal accounts
or credentials belonging to an individual developer for ongoing
government operation; if a handover is still in progress, document who
holds each credential and the planned transfer so ongoing operation does
not depend on one person.

## Environment variables

Never commit real values. Copy `.env.example` to `.env.local` for local
development and configure the same variables in Vercel (Project
Settings → Environment Variables) for production.

### Public Firebase configuration (safe to expose to the browser)

| Variable | Purpose | Where obtained |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client SDK config | Firebase Console → Project settings → General → Your apps → Web app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase client SDK config | Same as above |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase client SDK config | Same as above |

### Server secrets (never expose to the browser)

| Variable | Purpose | Secret? | Where obtained | Configured where |
| --- | --- | --- | --- | --- |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin SDK | No | Service account JSON | Vercel + `.env.local` |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase Admin SDK | No | Service account JSON | Vercel + `.env.local` |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase Admin SDK | **Yes** | Service account JSON (Firebase Console → Project settings → Service accounts → Generate new private key) | Vercel + `.env.local` |
| `CRON_SECRET` | Authorizes the nightly continuity-report cron request | **Yes** | Generate yourself (`openssl rand -hex 32`) | Vercel only |
| `RESEND_API_KEY` | Sends the continuity-report email | **Yes** | Resend dashboard → API Keys | Vercel + `.env.local` (if testing email locally) |
| `CONTINUITY_REPORT_EMAIL_FROM` | Sender address for the continuity report | No | Must be on a domain verified in Resend | Vercel + `.env.local` |
| `CONTINUITY_REPORT_EMAIL_TO` | Recipient list for the continuity report (comma-separated) | No | Government distribution list or shared operational inbox | Vercel + `.env.local` |
| `WHATSAPP_ACCESS_TOKEN` | Authorizes outbound Meta Graph API calls | **Yes** | Meta App Dashboard → WhatsApp → API Setup (or a System User token) | Vercel + `.env.local` |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifies which Cloud API number sends/receives messages | No | Meta App Dashboard → WhatsApp → API Setup | Vercel + `.env.local` |
| `WHATSAPP_APP_SECRET` | Verifies inbound webhook signatures | **Yes** | Meta App Dashboard → App Settings → Basic | Vercel + `.env.local` |
| `WHATSAPP_VERIFY_TOKEN` | Verifies the webhook subscription handshake | **Yes** (chosen by you) | Generate yourself (`openssl rand -hex 32`) | Vercel **and** Meta App Dashboard webhook configuration |

Without the Firebase variables set, the app still builds and runs,
showing a clear "not configured" state instead of failing. Without the
continuity-report or WhatsApp variables set, those specific features
degrade gracefully (see [`INTEGRATIONS.md`](./INTEGRATIONS.md)) rather
than breaking the rest of the application.

## Firebase

Deploy Firestore rules and indexes (and storage rules, if changed)
whenever they change:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

`firebase.json` points at `firestore.rules`, `firestore.indexes.json`,
and `storage.rules` in the repository root. Index changes can take
several minutes to build in Firestore after deploying; a query that
needs a not-yet-built index will fail until the build completes.

## Vercel

Deploying is a normal Vercel Git-integrated deployment — pushing to the
production branch triggers a build (`npm run build`, which uses
webpack; see [`TECHNICAL.md`](../TECHNICAL.md) for why Turbopack is not
used). Set all environment variables in Vercel Project Settings before
the first deploy that needs them; changing an environment variable
requires a redeploy to take effect.

## Cron

`vercel.json` schedules the continuity report:

```json
{ "crons": [{ "path": "/api/cron/continuity-report", "schedule": "0 0 * * *" }] }
```

`0 0 * * *` is evaluated in UTC by Vercel, which is exactly 8:00 PM
Saba time year-round (Saba is a fixed UTC-4 with no daylight saving, so
this never needs seasonal adjustment). Vercel Cron Jobs on the Hobby
plan are limited to at most 2 per day per project and do not guarantee
exact-minute execution; the Pro plan removes that limit and guarantees
tighter scheduling. Confirm the project's actual Vercel plan before
relying on this schedule as a strict guarantee.

## Resend

Production sends from a domain verified in Resend (Resend → Domains) —
this is the expected configuration, not an interim workaround. Resend's
own `onboarding@resend.dev` sender is only useful for local development
before a domain has been verified, and should not be used once a
verified domain is configured.

1. Add and verify your sending domain in Resend (Resend → Domains),
   following Resend's DNS verification instructions with your domain
   registrar.
2. Create an API key (Resend → API Keys) and set it as
   `RESEND_API_KEY` in Vercel (never commit it).
3. Set `CONTINUITY_REPORT_EMAIL_FROM` to an address on the verified
   domain (for example, a `waterdelivery@` address on that domain).
4. Set `CONTINUITY_REPORT_EMAIL_TO` to a government distribution list
   or shared operational inbox, not a personal address.

For local development only, before a domain is verified,
`onboarding@resend.dev` can stand in as `CONTINUITY_REPORT_EMAIL_FROM`
so email sending can be tested end-to-end.

## Meta/Facebook Login

Facebook Login is configured as a Firebase Authentication provider
(Firebase Console → Authentication → Sign-in method → Facebook), which
requires a Meta App with the Facebook Login product added and its App
ID/App Secret entered into Firebase. The public `/data-deletion` page
in this application satisfies Meta's required "Data Deletion
Instructions URL" field in the Meta App's Facebook Login settings.

## WhatsApp

1. In the same or a separate Meta App, add the WhatsApp product.
2. Under WhatsApp → API Setup, obtain a Phone Number ID and an access
   token (a System User token for production, since the default test
   token expires after 24 hours).
3. Under App Settings → Basic, copy the App Secret.
4. Choose your own random verify token and set it both in Vercel and in
   the Meta webhook configuration (Meta does not generate this value).
5. After deploying, set the webhook Callback URL to
   `https://<your-domain>/api/webhooks/whatsapp` in Meta App Dashboard
   → WhatsApp → Configuration → Webhook, using the verify token from
   step 4, then click Verify and Save.
6. Subscribe to the `messages` webhook field — this application does
   not read any other field.

Moving from Meta's Development mode (test numbers only) to Live mode
(able to message any real WhatsApp number) requires Meta Business
Verification, which is a manual process in Meta Business Manager and
can take from a day to a few weeks. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md) for more on this distinction.
