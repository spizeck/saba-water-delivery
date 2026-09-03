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

- Water-request quantity validation: 1-load → 1,000 gallons, 2-load →
  2,000 gallons, invalid load counts rejected, gallons derived
  server-side (`quantity.ts`).
- Dispatch priority determination and ranking (`priority.ts`).
- Batch Dispatch selection ordering, every validation rule (including
  the race scenario where a request changes state before confirmation,
  and the preferred-driver-override acknowledgment requirement), and
  derived batch status (`dispatchBatchSelection.ts`), plus its
  printable run-sheet data shaping and filename generation
  (`dispatchBatchPdfData.ts`, `dispatchBatchPdfFilename.ts`).
- Preferred-driver hold creation, expiration, and re-evaluation on
  priority change.
- Dispatch offer selection, decline/cooldown behavior, and avoiding
  re-offer loops.
- Delivery confirmation timeout and auto-confirmation logic.
- Delivery-profile reminder decision logic, including mandatory review
  for noncanonical villages (e.g., `Lower Hells Gate`) and phone display
  formatting (`formatPhone.ts`).
- Continuity report data selection/transformation and PDF filename
  generation.
- Continuity report email recipient parsing and payload construction.
- WhatsApp conversation state machine (`processMessage`), input
  parsing, phone matching, and webhook signature/config verification.
- Identity matching (`identityMatching.ts`): email/phone normalization,
  name-similarity rules, conservative match-strength assignment
  (strong email, medium phone, weak name-only), and the safe role-union
  helper used during account merges.
- Account setup email content: configuration reading, branded email
  payload construction, secure-link inclusion, and confirmation that no
  password appears in the message.
- Cron and webhook route behavior (mocking only the server-only/
  network boundary, never the pure logic underneath).
- Load collection helpers (`loadCollection.ts`): `areAllLoadsCollected`,
  `getMissingLoadNumbers`, historical meter snapshot integrity, default fill
  station, and statistics computation (`src/lib/domain/__tests__/loadCollection.test.ts`,
  17 tests).

Server-only modules (Firestore/Admin SDK access) are generally thin
wrappers around already-tested pure logic and are not independently
covered by a Firestore emulator in this project's test setup.

## Manual smoke test

Run through this checklist before a production deployment that touches
any of these areas.

### Resident

- Log in.
- Complete/update the delivery profile (phone, village, directions).
- If the saved village is noncanonical (e.g., `Lower Hells Gate`),
  confirm the reminder modal appears, shows the village as "Needs
  update," and does not offer "Everything Is Correct."
- Select a canonical village, save, and confirm the dropdown shows the
  saved value before and after refreshing.
- Submit a request for 1 load and verify it is stored/displayed as
  1,000 gallons.
- Submit a request for 2 loads and verify it is stored/displayed as
  2,000 gallons but still counts as one request.
- Attempt a second request while the first is still active; confirm it
  is blocked.
- Submit requests with no Notes / Comments and with a valid note; verify the
  note is trimmed, shown on review/detail, and is not written to the profile.
- Open a delivery confirmation email, select **Review Delivery**, authenticate
  if necessary, and verify the relevant confirmation controls open directly.
- Confirm a delivered request ("Yes, received").
- Repeat with another delivered request and dispute it ("No, there is a
  problem").

### Login / logout

- Facebook button appears greyed out with "Coming Soon" badge.
- Clicking the Facebook button does nothing (no OAuth attempt).
- Google and email/password login work normally.
- Log out from any portal and confirm you are returned to the login
  page. The back button should not return to the portal.

### Driver

- Go online.
- Receive an offer; confirm only one offer is shown at a time.
- Accept a delivery; confirm a second offer is not made until it is
  marked delivered.
- Decline enough offers to trigger the cooldown; confirm new offers
  pause.
- Confirm request Notes / Comments appear below the structured delivery
  directions when present and no empty notes section appears when absent.
- Mark a delivery complete; confirm the resident email is triggered and the
  next offer becomes available
  immediately, without waiting for resident confirmation.
- Have a Batch Dispatch batch assigned to this driver; confirm each
  load appears as its own claimed delivery with a "Batch assignment"
  label, and that no new normal offer is made while any batch load
  remains claimed.
- If a driver has a stale `activeRequestId` (pointing to a deleted or
  completed request), load the driver portal and confirm the stale
  lock is automatically cleared and the driver can receive the next
  offer normally.
- Accept an offer after stale-lock repair and confirm the request is
  claimed with a valid `activeRequestId`.
- Decline an offer after stale-lock repair and confirm the decline is
  recorded normally without a stale-active-delivery warning.

### Dispatcher

- Create a manual request for a registered resident and for an
  unregistered requestor; for each, verify 1-load and 2-load submissions
  store the correct gallons.
- Search for an existing resident, select them, and confirm the search
  results collapse and a compact "Selected requestor" card appears.
- Click **Change** and confirm the search interface reappears.
- Select a resident whose saved area is noncanonical (e.g., `Hell's Gate`);
  confirm the saved area is shown as "Needs update" and the **Delivery
  location** field is not prefilled with the legacy value.
- Select a resident with a valid canonical saved area and confirm it
  prefills the request **Delivery location**, which can still be overridden
  for this request without changing the resident's profile.
- Reach the **Review request** screen, confirm grouped information including
  Notes / Comments is clear, check the full-width attestation, and verify **Go
  Back** preserves all entered values.
- Edit Notes / Comments before claim and verify request detail, driver view,
  continuity report, delivery-run sheet, and `request_edited` history reflect
  the change.
- Mark a registered request delivered as staff and verify the same confirmation
  email/deep link used by the driver path. Confirm an unregistered request does
  not receive an authenticated confirmation link.
- Trigger and acknowledge a duplicate warning for an unregistered
  customer.
- Create a manual request for an unregistered requestor with no email;
  confirm the request succeeds without any account being created.
- Create a manual request for an unregistered requestor whose email
  matches an existing resident; confirm the existing account is
  suggested, and that selecting it creates a registered request.
- Create a manual request for an unregistered requestor with a new email
  and check **Send account setup instructions**; confirm the request
  succeeds and (if email is configured) the setup email arrives. Then
  simulate a delivery failure and confirm the request still succeeds with
  a dispatcher warning.
- Enter a phone number that matches an existing resident; confirm a
  possible match is shown and no automatic merge occurs.
- Override a request's priority with a reason.
- Reassign a claimed request to a different driver.
- Resolve a dispute.
- Generate a continuity report (download) and send one (email).
- Create a Batch Dispatch batch for an eligible driver with several
  loads; confirm the loads leave the general queue and the driver
  shows multiple claimed deliveries.
- Confirm a batch cannot be created if a selected load changed state
  first (e.g. claimed by another driver) — verify nothing is
  partially assigned.
- Select a load held for a different resident's preferred driver and
  confirm the override acknowledgment is required before submitting.
- Download and reprint a batch's dispatch sheet; confirm a reprint
  reflects current load status.
- Use "Record Delivery (paper reconciliation)" on a batch load and
  confirm it proceeds through the normal confirmation window.
- Reassign one load out of an active batch and confirm the rest of the
  batch is unaffected.
- Select a driver with a stale `activeRequestId` (no real active
  delivery) and confirm the assignment succeeds after automatic
  reconciliation.
- Select a driver with a real active delivery and confirm the
  assignment is still blocked.
- Confirm the driver workload view shows 0 open requests for a driver
  whose stale lock was cleared, not a contradictory "0 requests but
  blocked" state.

### Admin

- Create a Driver Registry entry.
- Link it to a user account; confirm the `driver` role appears.
- Restrict and restore a driver's eligibility.
- Change dispatch settings (max declines, cooldown hours) and confirm
  the change is audited.
- From a user detail page, review possible unregistered request history,
  select one or more matching requests, link them to the account, and
  confirm the historical customer snapshot is preserved unchanged while
  `customerId` now points to the user.
- Use **Merge Accounts** to reconcile two accounts that belong to the
  same person; confirm sensitive roles do not transfer unless explicitly
  selected, and that duplicate-owned requests are relinked. Confirm an
  audit record is created.
- Attempt to merge two accounts both linked to different Driver Registry
  entries and confirm the merge is blocked.

### Water collection tracking

- Record water collection for a one-load request and confirm the load is
  marked collected before the delivery can be marked delivered.
- Record water collection for both loads of a two-load request and confirm
  delivery is blocked until every load is collected.
- Trigger a missing meter error and confirm it corresponds to the driver's
  fill-station meter assignment.
- Reconcile a missing collection from the dispatcher portal and confirm the
  audit record is created.
- Confirm the dispatcher statistics view shows fill-station and meter totals
  correctly.

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
- Confirm a batch-assigned, undelivered load appears in the Assigned
  Loads section marked "(Batch)".
- Send a report now and confirm the email arrives with the PDF
  attached.
- Confirm the nightly cron route responds successfully when invoked
  with the correct `CRON_SECRET` bearer token (and is rejected without
  one, if `CRON_SECRET` is configured).
