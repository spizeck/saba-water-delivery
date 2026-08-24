# Testing

## Standard verification

Run before considering any change complete:

```bash
npx tsc --noEmit
npx eslint src
npx vitest run
npm run build
```

`npm run build` runs `next build --webpack`. This project pins the
webpack bundler (not Turbopack, which is the Next.js 16 default)
because Turbopack cannot currently bundle `fontkit`, a transitive
dependency of `pdfkit` used by the continuity-report PDF. Do not remove
`--webpack` from `package.json`'s `dev`/`build` scripts without first
confirming `npm run build` still succeeds — this is the exact command
Vercel's deployment runs.

## Unit tests

Vitest covers the pure domain logic extensively, including:

- Dispatch priority determination and ranking (`priority.ts`).
- Preferred-driver hold creation, expiration, and re-evaluation on
  priority change.
- Dispatch offer selection, decline/cooldown behavior, and avoiding
  re-offer loops.
- Delivery confirmation timeout and auto-confirmation logic.
- Delivery-profile reminder decision logic.
- Continuity report data selection/transformation and PDF filename
  generation.
- Continuity report email recipient parsing and payload construction.
- WhatsApp conversation state machine (`processMessage`), input
  parsing, phone matching, and webhook signature/config verification.
- Cron and webhook route behavior (mocking only the server-only/
  network boundary, never the pure logic underneath).

Server-only modules (Firestore/Admin SDK access) are generally thin
wrappers around already-tested pure logic and are not independently
covered by a Firestore emulator in this project's test setup.

## Manual smoke test

Run through this checklist before a production deployment that touches
any of these areas.

### Resident

- Log in.
- Complete/update the delivery profile (phone, village, directions).
- Submit a request; confirm it enters the queue.
- Attempt a second request while the first is still active; confirm it
  is blocked.
- Confirm a delivered request ("Yes, received").
- Dispute a delivered request ("No, there is a problem").

### Driver

- Go online.
- Receive an offer; confirm only one offer is shown at a time.
- Accept a delivery; confirm a second offer is not made until it is
  marked delivered.
- Decline enough offers to trigger the cooldown; confirm new offers
  pause.
- Mark a delivery complete; confirm the next offer becomes available
  immediately, without waiting for resident confirmation.

### Dispatcher

- Create a manual request for a registered resident and for an
  unregistered customer.
- Trigger and acknowledge a duplicate warning for an unregistered
  customer.
- Override a request's priority with a reason.
- Reassign a claimed request to a different driver.
- Resolve a dispute.
- Generate a continuity report (download) and send one (email).

### Admin

- Create a Driver Registry entry.
- Link it to a user account; confirm the `driver` role appears.
- Restrict and restore a driver's eligibility.
- Change dispatch settings (max declines, cooldown hours) and confirm
  the change is audited.

### Viewer

- Confirm requests and driver status are visible.
- Confirm no create/assign/cancel/confirm/dispute controls are
  available, and that phone/email/full delivery directions are not
  shown.

### WhatsApp

- Send a message to the webhook (or trigger the real Meta webhook) and
  confirm the verify-token handshake succeeds.
- Complete a full request conversation as an unregistered number.
- Complete a full request conversation as a number matching a
  registered resident.
- Resend the same webhook message ID and confirm it is not processed
  twice.
- Check status and confirm/dispute a delivery over WhatsApp.

### Continuity report

- Generate a report from the dispatcher dashboard and confirm the PDF
  opens and lists the correct outstanding requests.
- Send a report now and confirm the email arrives with the PDF
  attached.
- Confirm the nightly cron route responds successfully when invoked
  with the correct `CRON_SECRET` bearer token (and is rejected without
  one, if `CRON_SECRET` is configured).
