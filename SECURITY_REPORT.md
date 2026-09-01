# Saba Water Delivery Security Review

Review date: 1 September 2026

## Executive summary

The application has a sound baseline: authenticated sessions are verified on the server, operational writes use server-authorized Firebase Admin code, Firestore direct writes are denied, and Firebase Storage is currently fully locked down. This review found two high-severity configuration/authorization defects and one medium-severity audit-integrity defect. All three were fixed in source.

This review covers repository configuration and application code. It does not prove which optional Vercel or Firebase console controls are enabled in the live project.

## Findings and fixes

### High — scheduled report endpoint failed open when its secret was absent

The continuity-report cron route accepted public requests when `CRON_SECRET` was not configured. This could trigger report generation and email delivery without authorization.

**Fixed:** the route now fails closed with HTTP 503 when the secret is missing and returns HTTP 401 for an incorrect bearer token.

### High — crafted staff registration could assign privileged roles

The registration form displayed only resident and driver choices, but the server accepted any recognized role submitted in a manipulated request. A dispatcher could therefore create a Firestore-only person record carrying an admin, dispatcher, or viewer role. The record still lacked Firebase credentials, but retaining privileged roles was unsafe and could become exploitable through a future account-claim flow.

**Fixed:** both the server action and domain function now reject every registration role except resident and driver.

### Medium — staff collection reconciliation could name a different driver

Staff collection recording accepted an arbitrary driver ID instead of requiring the request's assigned driver. This could create incorrect meter and driver attribution in the audit trail.

**Fixed:** staff and driver collection recording now both require the recorded driver to match `assignedDriverId`.

### Medium — missing baseline browser security headers

The repository did not configure response security headers.

**Fixed:** all application routes now receive HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict-origin referrer policy, and a restrictive Permissions Policy. A Content Security Policy was not added without a deployment-specific compatibility test for Firebase Authentication and Next.js runtime scripts.

### Moderate dependency advisory — not automatically changed

`npm audit --omit=dev` reports eight moderate findings originating from the Firebase Admin dependency tree (`uuid` through Google Cloud packages). The suggested forced remediation would downgrade `firebase-admin` to an old breaking version and was not applied. Monitor Firebase Admin releases and update when its dependency tree contains the upstream fix.

## Vercel security status

### Confirmed from repository configuration

- The project is configured for Vercel Cron at `/api/cron/continuity-report`.
- That route requires a matching `CRON_SECRET` bearer token and now fails closed if configuration is missing.
- Server-only secrets use non-`NEXT_PUBLIC_` environment variable names.
- `.env.local`, `.vercel`, PEM files, build output, and debug logs are ignored by Git.
- Browser source maps are not explicitly enabled; Next.js therefore retains its default production behavior.
- Application response security headers are configured in `next.config.ts`.
- Staff report/PDF endpoints require server-verified dispatcher or admin roles.

### Platform protections Vercel normally provides automatically

These are platform capabilities, not project-dashboard settings proven by this repository:

- HTTPS/TLS termination for Vercel deployments and managed domains.
- Network-level DDoS mitigation on the Vercel platform.
- Isolation and routing for serverless/edge execution.

The live domain, certificate status, and account/plan-specific protection levels must still be confirmed in Vercel.

### Cannot be verified from this repository — check Vercel Dashboard

- Whether production and preview deployments use Deployment Protection, password protection, or Vercel Authentication.
- Whether the Vercel Firewall/WAF is enabled and which custom rules exist.
- Whether Bot Management or bot challenge rules are enabled.
- Whether application-level rate-limit rules are enabled for login, webhooks, reports, or other endpoints.
- Whether IP allowlists, geolocation restrictions, managed rulesets, or attack challenge modes are enabled.
- Whether environment variables are correctly scoped to Production/Preview/Development and marked sensitive.
- Whether audit logs, team SSO, MFA enforcement, least-privilege project roles, and protected production branches are configured.
- Whether custom domains redirect HTTP to HTTPS and have healthy certificates.
- Whether function logs or monitoring contain sensitive request data.

## Firebase permissions review

### Firestore

- Rules use a deny-by-default final match.
- Direct writes to water requests, request events, driver registry, driver offers, delivery runs, config, WhatsApp state, and account-merge audits are denied. Mutations go through trusted server code.
- A resident can directly read only their own `users/{uid}` profile and requests whose `customerId` equals their authenticated UID.
- An assigned driver can read only requests whose `assignedDriverId` equals their authenticated UID and offers addressed to them.
- Dispatchers/admins have operational read access; admin-only role management is separately enforced by server actions.
- Guessing a request, event, photo, user, driver, or offer document ID does not bypass the rules because access is checked against authentication, ownership/assignment, or role.
- Client profile updates cannot change the `roles` field. New direct client-created profiles are limited to one `resident` role.
- Audit/event writes are denied to clients, preserving server-authorized audit integrity.
- Viewer access includes full underlying request documents. The viewer UI shows a reduced projection, but Firestore rules permit the viewer role to read request PII. Confirm with the Public Entity that this is intentional.

### Storage and photos

- Firebase Storage currently denies all reads and writes, including property and request photo paths.
- Firestore photo metadata has owner/staff/assigned-driver rules, but the actual binary files remain inaccessible until a deliberately designed photo workflow is implemented.
- No permanent public photo-download URLs should be introduced. Use access-controlled reads or short-lived signed URLs when photos are enabled.

### Authentication and Admin SDK

- Firebase ID tokens are verified server-side before creating an HTTP-only session cookie.
- Session cookies are re-verified with revocation checking; roles are re-read from Firestore.
- New authenticated profiles default to resident and cannot self-assign staff roles.
- Firebase Admin initialization is marked `server-only`, and service-account credentials are read only from server environment variables.
- The session cookie is Secure in production, HTTP-only, SameSite=Lax, and scoped to `/`.
- The non-HTTP-only portal cookie is only a navigation preference and is checked against server-side roles before use.

### Server actions and API routes

- Dispatcher operations require dispatcher/admin on the server.
- Driver operations bind the acting driver ID to the authenticated session and validate assignment in domain code.
- Resident confirmation/dispute actions validate request ownership in domain code.
- Admin role and registry management requires admin on the server.
- WhatsApp webhook endpoints are public by design and use Meta signature/token verification.
- Manual continuity and delivery-run PDF routes require dispatcher/admin authorization.

## Remaining recommendations

1. Verify Vercel Firewall/WAF, rate limiting, bot protection, Deployment Protection, MFA/SSO, and production environment scoping in the dashboard.
2. Confirm deployed Firestore and Storage rules match the checked-in files using Firebase Console or deployment tooling.
3. Confirm authorized Firebase Authentication domains and enabled sign-in providers; remove unused providers.
4. Review whether viewer-role access to complete request documents is acceptable or should be replaced by a server-produced reduced dataset.
5. Add deployment-tested Content Security Policy headers after validating Firebase Authentication and all Next.js scripts.
6. Consider Origin validation and rate limiting on the session-creation endpoint.
7. Monitor the Firebase Admin transitive dependency advisory rather than applying the unsafe forced downgrade.
8. Enable alerts/log review for repeated authentication failures, webhook signature failures, cron authorization failures, and unusual report generation.

## Data and secrets statement

No production data was deleted or rewritten during this review. No credentials, tokens, private keys, or environment variable values are included in this report.
