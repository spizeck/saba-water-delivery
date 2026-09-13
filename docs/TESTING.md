# Testing

This project targets **Node.js 24** (pinned in `.nvmrc` and
`package.json` `engines`). Use `fnm use` / `nvm use` to match it before
running the commands below.

## Standard verification

Run the full non-destructive suite before considering any change
complete:

```bash
npm run check
```

`check` runs, in order: `format:check` (Prettier) → `lint` (ESLint) → `typecheck` (`next typegen`
then `tsc --noEmit`) → `test` (Vitest) → `build` (`next build
--webpack`). It requires no credentials, no live Firebase, and no
network services. The equivalent individual commands are still available
if you want to run one step:

```bash
npm run lint       # ESLint
npm run typecheck  # next typegen (generate route types) then tsc --noEmit
npm run test       # Vitest (npx vitest run)
npm run build      # Production build; postbuild runs the PDFKit trace check
```

`typecheck` runs `next typegen` before `tsc` on purpose. Next 16
generates the `LayoutProps`/`PageProps`/route types into `.next/types/`;
on a clean checkout (no `.next/`) a bare `tsc --noEmit` fails with
`Cannot find name 'LayoutProps'`, so the type generation must run first.

`npm run build` runs `next build --webpack`. This project pins the
webpack bundler (not Turbopack, which is the Next.js 16 default)
because Turbopack cannot currently bundle `fontkit`, a transitive
dependency of `pdfkit` used by the continuity-report PDF. Do not remove
`--webpack` from `package.json`'s `dev`/`build` scripts without first
confirming `npm run build` still succeeds — this is the exact command
Vercel's deployment runs. `build`'s `postbuild` step runs
`scripts/verify-pdfkit-trace.mjs`, which fails the build if any server
bundle that reaches a PDFKit renderer is missing pdfkit's font/color
asset trees (the exact packaging regression that has broken production
PDFs before).

### Security-rules tests

The Firestore and Storage security rules have their own test suite
(`firestore.rules.test.ts`), which runs against the local Firebase
emulators and needs a JVM installed:

```bash
npm run test:rules
```

This is kept out of `npm run check` (it is heavier and emulator-backed)
but is run in CI. It never contacts production Firebase — the emulators
run entirely locally against a throwaway test project id.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`. It has a single job, **verify** — the required branch-protection
status-check context is the bare job name **`verify`** (the PR "Checks" UI
displays it as **`CI / verify`**), which:

1. checks out the repo and sets up Node from `.nvmrc` with npm caching;
2. sets up a Temurin JVM for the Firebase emulators;
3. runs `npm ci`;
4. runs `lint` → `typecheck` → `test` → `build` (with the PDFKit trace
   verification) → `test:rules` → `format:check` — all **blocking**.

One step is **informational only** (it runs with `continue-on-error`, so
it never blocks a merge):

- `npm audit --audit-level=high` — the only outstanding advisories are
  transitive (`firebase-admin`/`@google-cloud/*` and Next's `sharp`) and
  need breaking upstream bumps; Dependabot handles dependency updates.

What CI intentionally does **not** do:

- It uses **no production secrets**. The build runs with no Firebase
  configuration and still succeeds (the app renders its "not configured"
  state), unit tests exercise pure domain logic, and rules tests use
  local emulators only.
- It does **not** deploy. Vercel's Git integration owns Preview and
  production deployments (see [`DEPLOYMENT.md`](./DEPLOYMENT.md)). CI
  verifies code correctness; Vercel Preview verifies deployment/render
  behavior.

## End-to-end tests (Playwright)

Browser-level regression coverage for the highest-value real user journeys,
run against **local Firebase emulators** with synthetic data — never
production Firebase, credentials, email, or WhatsApp.

### Running locally

```bash
# One-time: install the Chromium browser Playwright drives.
npx playwright install chromium

# Run the whole suite (starts the Auth + Firestore emulators, builds and
# serves the app in emulator mode, seeds data, runs the tests, tears down).
npm run test:e2e
```

You need a **JVM** on your PATH (the Firestore emulator requires Java, same as
`npm run test:rules`). `npm run test:e2e` wraps `playwright test` in
`firebase emulators:exec --project demo-saba-water-delivery --only auth,firestore`,
so the emulators are running and their host variables are set for the app and
the seed step.

Other scripts:

```bash
npm run test:e2e:ui      # Playwright UI mode (watch/inspect)
npm run test:e2e:headed  # run with a visible browser
npm run test:e2e:report  # open the last HTML report
```

`npm run test:e2e` is intentionally **not** part of `npm run check` — it is a
separate, heavier, emulator-backed gate (its own CI check, below).

### How authentication works (no OAuth, no bypass)

Tests sign in through the **real login UI** using the app's email/password
provider pointed at the **Firebase Auth emulator** (`loginAs()` in
`e2e/support/auth.ts`). That exercises the entire real auth path —
`signInWithEmailAndPassword` → `getIdToken()` → `POST /api/auth/session` →
session cookie → server role check — with only the identity provider swapped
for the local emulator. Live Google OAuth is **not** automated (it remains a
manual smoke test). There is no test-only auth bypass: the client connects to
the emulator only when `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is set (never
in a production build), and the Admin SDK enters emulator mode only when
`FIREBASE_AUTH_EMULATOR_HOST`/`FIRESTORE_EMULATOR_HOST` are set — with a hard
guard (`src/lib/firebase/admin.ts`) that refuses emulator mode in Vercel
Production/Preview.

### Test data, roles, and isolation

- **Seeded roles** (`e2e/support/config.ts`): `resident`, `driver`,
  `dispatcher`, and `admin` — deterministic uids/emails/passwords that only
  ever exist in the local Auth emulator. The resident has a complete canonical
  profile; the driver has a linked Driver Registry entry (online, eligible)
  with a meter at the default fill station.
- **Seeding** (`e2e/support/seed.ts`) writes plain documents via the Admin SDK
  against the emulator. Global setup (`e2e/global-setup.ts`) clears the
  emulators and seeds the baseline once; each spec that mutates shared state
  calls `resetToBaseline()` in `beforeEach`, and per-test entities (water
  requests, delivery runs) use unique ids. Tests are independent and do not
  depend on ordering.
- **Safety guard** (`e2e/support/safety.ts`, mandatory): every seed/reset and
  global setup asserts the Auth + Firestore emulator hosts are set, the project
  id is a `demo-` project, and we are not in a deployed Vercel environment —
  and fails loudly otherwise. It is impossible for the suite to touch
  production.
- **External integrations**: Resend and WhatsApp/Meta are never called — the
  covered flows use server-side state (e.g. delivery confirmation navigates the
  authenticated review route from seeded state rather than a real email link),
  so no test-only email/WhatsApp subsystem is needed.

### What is covered

`e2e/tests/`:

- **route-protection** — `/resident`, `/driver`, `/dispatcher` redirect
  unauthenticated visitors to login; a deep review link preserves `returnTo`.
- **auth** — resident/dispatcher/driver establish a session through the real
  login flow; a resident is denied the dispatcher portal (`/access-denied`);
  logout clears access and back-navigation cannot reopen the portal.
- **resident-request** — 1-load happy path with notes (becomes the active
  request; Firestore state verified) and a 2-load quantity check.
- **resident-profile** — a canonical village chosen and saved stays selected
  after the server action re-render and a full reload (the known remount bug).
- **dispatcher-request** — search an existing resident, select, "Change"
  requestor, review, and create; asserts a dispatcher-sourced request with the
  normal-urgency default.
- **dispatcher-assignment** — from only an unassigned `available` request (no
  seeded claimed state), a dispatcher assigns an eligible driver through the real
  `/dispatcher/<id>` "Assign driver" UI, then that driver signs in and sees the
  request in their open work with the correct requestor/village/quantity —
  proving the dispatcher→driver handoff. Direct assign is used because it is the
  supported path for handing one request to one driver.
- **driver-workflow** — a claimed request is seeded; the driver records
  collection at the default station, is blocked from delivering until all loads
  are collected, and marks delivered (plus a 2-load 1/2 → 2/2 progression).
- **resident-confirmation** — a delivered request is confirmed from the review
  route (→ `confirmed`), and a second test reports a problem with a reason
  (→ `disputed`, with the dispute reason persisted on the `customer_disputed`
  audit event).
- **delivery-run** — a run with a claimed + a delivered member is opened by a
  dispatcher (a delivered/awaiting-confirmation item does not block remaining
  work), and the run-sheet PDF endpoint returns a PDF.
- **health-security** — `/api/health` returns 200, `/api/readiness` reports
  `ready` against the local Firestore, and page responses carry the CSP header.

### Configuration

`playwright.config.ts`: Chromium only; `workers: 1` (serial — the suite shares
emulator state and the real session flow); `retries: 0` locally / `1` in CI (a
retry never excuses a genuinely flaky test); `trace: retain-on-failure`,
`screenshot: only-on-failure`; the HTML report is written to
`playwright-report/`. No arbitrary sleeps are used — assertions are web-first
(`toBeVisible`, `toHaveURL`, `waitForURL`).

### CI

`.github/workflows/e2e.yml` runs a single job, **playwright** — its
branch-protection status-check context is the bare job name **`playwright`**
(displayed in the PR "Checks" UI as **`E2E / playwright`**). It sets up Node 24
+ Temurin JVM, installs Playwright Chromium (`--with-deps`), and runs
`npm run test:e2e`; the HTML report is uploaded as an artifact. It is a
**separate** check from `verify`, so an E2E failure is easy to isolate.
Both `verify` and `playwright` are **required** status-check contexts in the
current "Protect Main" ruleset (see [`DEPLOYMENT.md`](./DEPLOYMENT.md)). CI uses
no production secrets and never contacts a live Google account.

### What this suite protects (and what it does not)

It meaningfully guards, at the browser level: Next.js client/server routing and
navigation, React rendering of the critical forms, Firebase client SDK sign-in
and Firebase Admin/session behavior, CSS/UI regressions in the covered flows,
auth/authorization boundaries, and the run-sheet PDF route. It does **not**
replace: live Google OAuth (the popup), real Resend email delivery, real
WhatsApp/Meta delivery, PWA install behavior, or visual/pixel regressions —
those remain the manual preview smoke test below.

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
- Operational logging (`src/lib/logging/__tests__/`): redaction of
  email/phone/tokens/secrets and nested objects, safe error serialization
  (provider error objects are never spread), request/correlation ID
  generation and validation, that the logger never throws and always emits
  JSON, that representative critical-path logs do not leak request notes,
  delivery directions, or raw WhatsApp message content, and that
  `security.*` events carry only safe metadata.
- Browser security headers (`src/lib/security/__tests__/`): the generated
  Content-Security-Policy and companion headers as structured directives — a
  restrictive `default-src`/`base-uri`/`object-src`/`frame-ancestors`, no
  wildcards in `script`/`connect`/`frame` sources, no `'unsafe-eval'` in
  production, the required Firebase/Google auth origins present, server-only
  (Meta/Resend/Firestore) and GA4 origins absent, dev/preview allowances not
  leaking into production, the `CSP_REPORT_ONLY` toggle, COOP
  `same-origin-allow-popups` with no COEP, and intentional Permissions-Policy
  and HSTS. CSP is a browser-runtime concern, so these unit tests are backed by
  the required Vercel **preview smoke test** in [`DEPLOYMENT.md`](./DEPLOYMENT.md)
  (an automated browser test arrives with issue #34's Playwright work).
- Rate limiting (`src/lib/security/__tests__/rateLimit.test.ts`): the
  fixed-window algorithm (below/at/above limit, window reset, server-supplied
  time), identifier and policy isolation, IP normalization, fail-open on a
  storage error (with an operational log and no false rejection event), the
  `security.rate_limit.exceeded` event carrying only the identifier *type*
  (never a raw IP/value), `enforceRateLimit` throwing a 429/`RATE_LIMITED`
  error with `Retry-After`, and trusted-IP extraction. The Firestore store's
  transaction **atomicity under concurrency** is proven against the emulator in
  `firestore.rateLimit.emulator.test.ts` (run by `npm run test:rules`), and
  `firestore.rules.test.ts` confirms the `rateLimits` collection is
  deny-by-default for clients.
- Error handling (`src/lib/errors/__tests__/`, `src/lib/http/__tests__/`):
  `AppError` category/code/status mapping, `normalizeError` for known/unknown
  errors, the flat client error body (public message vs. generic; no raw
  exception message, stack, Firebase, or provider detail; `requestId`
  included), preservation of 4xx statuses, and the `withApiRoute` boundary —
  an unexpected throw yields a safe 500 with the request ID in the header and
  body, a thrown `AppError` yields its intended status, `redirect()` still
  propagates, and one failure is logged exactly once.
- Health and readiness (`src/lib/health/__tests__/readiness.test.ts`,
  `src/app/api/health/__tests__/route.test.ts`,
  `src/app/api/readiness/__tests__/route.test.ts`): liveness returns a boring
  `{ status: "ok" }` 200 with an `x-request-id` header and no config/secrets;
  readiness is 200 `ready` when the (mocked) Firestore probe succeeds and **503**
  `not_ready` when it fails or Firebase Admin is unconfigured; the readiness body
  is only categorical (`ok`/`unavailable`), so a raw Firestore exception message,
  stack trace, `FIREBASE_ADMIN_PRIVATE_KEY`, project id, service-account email,
  and the `_health` probe path **never** reach the client; the default probe
  issues a single read (`.get()`) with **no** `set`/`add`/`update`/`delete`
  (proving no production write); an optional-integration outage does not fail
  readiness; a successful probe emits no error/warn logs while a failure emits
  exactly one sanitized `health.readiness.failed` event; and `withTimeout` bounds
  a hung probe. These run in the plain `vitest` suite — no Firebase emulator,
  network, or production project is used.
- Disaster-recovery validation (`scripts/lib/__tests__/recovery-checks.test.ts`):
  the read-only cross-document consistency checks used after a restore (logic in
  `scripts/lib/recovery-checks.mjs`). Covers representative inconsistent states —
  a stale driver `activeRequestId` (missing/reassigned/delivered), a claimed
  request assigned to the wrong or a non-existent driver, a delivery run pointing
  at a missing request (and a request pointing at a missing run), and an orphaned
  registered-request owner — plus the per-category summary. Pure and synthetic:
  no Firestore, no production data, no PII.
- Production integrity diagnostic (issue #52):
  - `scripts/lib/__tests__/integrity-checks.test.ts` — the fuller integrity
    check set (`runIntegrityChecks`): the DR checks above **plus** two-way
    Delivery Run membership/driver/status, preferred-driver references,
    user-role ↔ registry linkage, and impossible request-state fields. Includes
    **valid-state / false-positive tests** (a normal claimed request, a
    legitimate Delivery Run exception, a terminal batch member that keeps its
    `dispatchBatchId`, a valid preferred-driver hold with an offline driver, and
    an intentionally unregistered request) that must NOT be flagged, and asserts
    the severity model.
  - `scripts/lib/__tests__/integrity-target.test.ts` — target/production safety:
    no target rejected, ambiguous emulator+cloud rejected, cloud requires
    `--production`, `--production` against the emulator rejected, ADC requires an
    explicit project, and inline service-account JSON rejected — proving the
    resolver cannot silently fall back between emulator and cloud.
  - `scripts/lib/__tests__/integrity-scan.test.ts` — bounded scanning
    (operational vs `--full-scan`, referenced-doc resolution so pagination
    cannot cause false "missing" findings, truncation reporting), the exit-code
    contract, and a **read-only proof**: the Firestore reader driven against a
    fake db whose every write method throws still completes using only reads.
  - `scripts/lib/__tests__/activeRequestRuleParity.test.ts` — pins the operator
    tooling's standalone copies of `classifyDriverLock` / `deriveBatchStatus` to
    the canonical `checkActiveRequestValidity` / `computeDispatchBatchStatus` so
    the intentional (no-build-step) duplication cannot drift silently.
  All pure and synthetic: no Firestore, no production data, no PII.

Server-only modules (Firestore/Admin SDK access) are generally thin
wrappers around already-tested pure logic and are not independently
covered by a Firestore emulator in this project's test setup.

## Disaster-recovery validation drill

Beyond the unit tests above, the read-only recovery validator can be run against
a live database (a restored copy, an isolated/test project, or the emulator) —
never against production as a mutation, since it only reads:

```bash
# Local, no cloud cost: run against the Firestore emulator (empty → 0 findings).
firebase emulators:exec --only firestore "node scripts/verify-recovery.mjs"

# Against a restored named database in an isolated/test project. Credentials come
# from a key FILE (never inline the JSON on the command line). Pass the database
# name so you validate the restore, not (default).
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  node scripts/verify-recovery.mjs --database=recovery-<YYYYMMDD>
```

It exits non-zero when it finds inconsistencies, so a restore drill can gate on
it. See [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) for the full restore
drill and post-restore validation checklist. Do **not** add browser (Playwright)
tests for backups — E2E is unrelated to backup/restore mechanics.

The read-only **production integrity diagnostic** (issue #52,
`scripts/production-integrity.mjs`) is a separate, routine tool that shares the
same pure checks but adds bounded/paginated reads and stricter cloud-target
safeguards — see [`OPERATIONS.md`](./OPERATIONS.md) "Checking data integrity". It
can be exercised locally against the emulator the same way:

```bash
firebase emulators:exec --only firestore "node scripts/production-integrity.mjs"
```

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

These are future-activation checks for a deliberately configured test context.
WhatsApp ordering is not available to live residents; see
[INTEGRATIONS.md](./INTEGRATIONS.md). Do not interpret this checklist as
production activation evidence.

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

### Health and readiness

- `curl -i https://<deployment>/api/health` returns **200** with
  `{"status":"ok"}` and an `x-request-id` response header.
- `curl -i https://<deployment>/api/readiness` returns **200** with
  `{"status":"ready","checks":{"app":"ok","firestore":"ok"}}` on a
  correctly configured deployment.
- Confirm neither response body contains any project id, service-account
  email, private key, environment value, Firestore path, stack trace, or
  error message.
- Confirm normal app login, the resident portal, and the dispatcher portal
  still load, and that PDFs still generate (health work touches none of
  these paths).
- Optional (local/emulator only): simulate Firestore being unavailable and
  confirm `/api/readiness` returns **503** with
  `{"status":"not_ready","checks":{"app":"ok","firestore":"unavailable"}}`
  while `/api/health` stays 200. Do **not** break production to test this.
