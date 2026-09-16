# Saba Water Delivery — Security and Readiness Assessment

**Assessment date:** 2026-09-16
**Assessed release:** `v0.9.1` — Stability and production-readiness maintenance
**Assessed commit:** `eba8e2d4b6e14ce1714075ce8e14521be65c3ddc`
**GitHub Release:** https://github.com/spizeck/saba-water-delivery/releases/tag/v0.9.1
**Assessed deployment:** the live pilot at `https://saba-water-delivery.vercel.app` (running the assessed commit)
**Previous assessment:** 2026-09-01 — preserved unchanged at
[`docs/security/SECURITY_REPORT_2026-09-01.md`](./docs/security/SECURITY_REPORT_2026-09-01.md)
**Tracking issue:** #90

This report replaces the September 1, 2026 snapshot as the current
assessment. The earlier report is retained as dated historical evidence;
its findings were not retroactively edited.

---

## 1. Executive summary

The `v0.9.1` codebase implements a materially stronger control set than
the September 1 snapshot: deny-by-default Firestore rules verified by an
extensive emulator suite, server-verified Firebase sessions with
revocation checking, a centralized validated configuration boundary,
enforced Content-Security-Policy and companion browser headers, durable
notification and account-merge reconciliation machinery, a corrected
account-merge authorization model, atomic audit records, and
non-destructive production diagnostics and smoke tooling.

On the evidence below, the assessed release is **suitable to proceed
into government staging and handover activities**. No code-level blocker
was identified in the assessed release. Government production acceptance
is **not** complete and should not be described as such: the
infrastructure-ownership, backup, monitoring, staging-acceptance, and
handover gates tracked in #56–#63, #83, and the dependency follow-up in
#94 remain open and are enumerated in §19–§21.

## 2. Scope and methodology

This assessment covers the application at the immutable `v0.9.1` tag —
not moving `main` — and the deployed pilot running that commit. Sources
of evidence: direct inspection of the tagged tree, the unit/rules/Auth
emulator/Playwright suites executed against the tagged commit, read-only
HTTP probes and runtime-log inspection of the live pilot, `npm audit`,
and GitHub issue state for the operational gates.

This assessment did **not** authenticate as a real user, invoke mutation
or cron endpoints, send email, modify production data, or change
infrastructure. No secrets, credentials, resident data, or internal user
identifiers appear in this report.

## 3. Evidence classification

Every conclusion below carries one of these levels:

| Level | Meaning |
|---|---|
| **A — Code-inspected** | Verified by reading the tagged implementation |
| **B — Automated-tested** | Verified by unit/integration tests |
| **C — Emulator-tested** | Verified against Firebase/Firestore/Auth emulators |
| **D — Pilot-verified** | Verified non-destructively against the deployed pilot |
| **E — Staging/provider required** | Implemented, but real-provider or government staging acceptance is outstanding |
| **F — Infrastructure/operational required** | Depends on government-owned infrastructure, credentials, monitoring, or recovery exercises |

A unit test is not pilot verification; an emulator test is not real
Firebase production verification; a deployed code path is not government
acceptance.

## 4. Architecture and trust boundaries (A)

- **Browser/client:** untrusted. Client code uses only Firebase Auth
  (Google sign-in popup) and same-origin API calls; there is no
  client-side Firestore or Storage access. Client UI gating is UX only —
  never an authorization boundary.
- **Firebase Authentication:** issues ID tokens; the app exchanges them
  for an httpOnly session cookie at `POST /api/auth/session`.
- **Server (Next.js serverless on Vercel):** the trusted boundary. All
  operational reads/writes flow through Server Components, route
  handlers, and server actions using the Firebase Admin SDK
  (`server-only` module), with per-call authorization checks and domain
  state-machine enforcement.
- **Firestore Security Rules:** defense in depth — deny-by-default;
  direct client reads are limited to the small set an authenticated role
  genuinely needs (see §7).
- **Cron boundary:** Vercel Cron routes (`/api/cron/*`) require
  `Authorization: Bearer $CRON_SECRET`; the route fails closed (503)
  when the secret is absent and 401 on a wrong token. (A, D — both cron
  routes return 200 on schedule in production.)
- **External providers:** Firebase/GCP (Auth, Firestore), Vercel
  (hosting/cron), Resend (transactional email via the Vercel-managed
  integration), Meta/WhatsApp (resident ordering webhook,
  signature-verified). Each is optional-or-degradable except Firebase.
- **Admin/operator trust:** role and merge administration require the
  `admin` role on the server; operator scripts are explicit,
  acknowledged, and non-destructive by default (§14–§15).

## 5. Authentication and sessions

- **ID-token → session-cookie exchange** (`POST /api/auth/session`):
  verifies the Firebase ID token with `checkRevoked: true` before minting
  a session cookie (A; D — POST returns 200 on the pilot).
- **Session cookie:** `httpOnly`, `sameSite=lax`, `secure` in production,
  5-day max age; verified on every server request with revocation
  checking (`checkRevoked: true`) so disabled/revoked users lose access
  at the next verification (A, C).
- **Merged-away identity rejection:** a user document carrying
  `mergedIntoUserId` is rejected at both the session-creation boundary
  (403) and the existing-cookie boundary — even while Firebase Auth
  cleanup is still pending (A, C — covered by the Auth-emulator merge
  reconciliation suite; see §13).
- **Roles re-read from Firestore** on each session verification; JWT
  custom claims are not the authorization source (A).
- **Firebase popup compatibility:** COOP is `same-origin-allow-popups`
  so `signInWithPopup` keeps its opener relationship; COEP is
  deliberately unset (A; D — header confirmed on pilot).
- **Authorized-domain assumption:** the set of Firebase authorized
  domains is a console setting the repository cannot verify — remains an
  E/F console-verification item (see §19 checklist).

Evidence: A (implementation), C (session lifecycle and merged-identity
rejection suites), D (session endpoint healthy on pilot). Still dependent
on production provider behavior: Google OAuth popup flow end-to-end (E —
part of #83 acceptance).

## 6. Authorization

- **Multi-role model:** `resident`, `driver`, `dispatcher`, `admin`,
  `viewer`. Server-side checks gate every portal and mutation (A, B, C).
- **Route/portal protection:** unauthenticated users are redirected to
  `/login`; role-mismatched users are denied (`/access-denied` or
  filtered UI) — E2E-verified (B/C via Playwright: 33 tests include
  auth, route-protection, and viewer-denial cases; D via smoke).
- **Account merge (issue #95, corrected in this release):** union mode
  computes `canonical roles ∪ (duplicate roles ∩ {resident, viewer})`
  from fresh transactional reads — canonical privileged roles cannot be
  stripped and duplicate privileged roles cannot transfer implicitly.
  Explicit mode remains the only deliberate path to move privileged
  roles, subject to confirmation and invariants. (A, C — 10-test
  emulator regression suite covering the confirmed incident shape,
  inverse privilege-escalation, and both preview-to-commit race
  directions.)
- **Last-admin invariant (issue #70):** every role mutation that could
  remove the final usable admin is rejected inside the transaction,
  including merges that decommission the last admin's duplicate (A, C).
- **Driver registry eligibility:** driver actions validate registry
  linkage and eligibility; archived drivers are ineligible for offers
  (A, B, C).

## 7. Firestore Security Rules

`firestore.rules` is deny-by-default with a catch-all denial for unknown
collections (A). The permission matrix from the September 1 assessment
remains accurate, with additions:

- `users`: owner or staff read; owner updates restricted to a four-field
  allowlist (`displayName`, `phone`, `village`, `deliveryDirections`);
  create/delete denied — provisioning is server-only.
- `waterRequests`: read by owning resident, assigned driver, or staff;
  all writes denied (server-only lifecycle).
- `waterRequests/*/events`, `driverRegistry` (+events/meters),
  `driverOffers`, `config` (+events), `dispatchBatches` (+events):
  staff-read only, writes denied.
- `whatsappSessions`, `whatsappProcessedMessages`, `accountMergeEvents`,
  `notificationOutbox`, `rateLimits`, `systemInvariants`, photo
  collections: deny-all — server-only via Admin SDK.
- `fillStations`: authenticated read, writes denied.
- Merged-away accounts: no rules behavior depends on merge state;
  enforcement is at the session/domain layer (A).

Verification: 205 Firestore/Storage emulator tests (C) covering allowed
and denied paths per role and collection. **Limitations:** emulator tests
exercise the rules engine, not the deployed rules — console verification
that deployed rules match this file is an F item; rules cannot express
rate/abuse limits or cross-document invariants (handled server-side);
queries must be constraint-compatible or they are rejected rather than
filtered.

## 8. Administrative and security-sensitive operations (A, C)

All of the following are server-only (Admin SDK), role-gated, and audited
atomically with the mutation where an audit record is required:

- Role grants/removals — admin only; last-admin invariant enforced.
- Account merge — admin only; atomic transaction; durable audit event;
  see §6 and §13.
- Driver registry lifecycle — admin archive/restore with reasons;
  permanent deletion restricted to unlinked test/duplicate records after
  reference checks and exact-name confirmation.
- Staff-recorded disputes, manual request creation, priority overrides,
  delivery completion, cancellations — each routed through the domain
  layer with authorization and state-machine checks (B, C).
- User management — registration restricted to `resident`/`driver` role
  grants (the September 1 privileged-role escalation stays fixed).

## 9. Auditability (ADR 0010)

- **Business/security audit events** are written transactionally with the
  mutations they describe — atomicity verified by emulator tests
  including crash-window cases (A, C).
- **Operational logs** are structured JSON to the platform log stream;
  they are not audit records and carry no PII/secret values by
  construction (A, D).
- **No-rewrite principle:** audit/history records are preserved; no
  historical migration or rewrite was performed (A).
- **Account merge events** record the merge decision, the committed role
  set (`mergedRoles` equals what the transaction wrote), and durable
  Auth-reconciliation state (A, C).
- **Honest limitation:** application audit documents are Firestore
  records — durable and tamper-evident relative to application actors,
  but not platform-immutable; a holder of the Admin SDK credential could
  in principle alter them. This is inherent to the architecture and is
  one reason credential custody (#56, #61) matters.

## 10. HTTP and browser security

Verified by code (A), unit tests (B — 16-test header suite), E2E (C), and
live pilot headers (D — retrieved by read-only GET on `/login`):

- **Content-Security-Policy** (enforcing, not report-only):
  `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`;
  `form-action 'self'`; `script-src 'self' 'unsafe-inline'
  https://apis.google.com`; `style-src 'self' 'unsafe-inline'`;
  `img-src 'self' data:`; `font-src 'self'`; `connect-src` limited to
  self + Firebase Auth endpoints; `frame-src` self + auth domain +
  apis.google.com; `worker-src 'self'`; `manifest-src 'self'`;
  `upgrade-insecure-requests`.
- **HSTS** `max-age=31536000; includeSubDomains` (production builds).
- **COOP** `same-origin-allow-popups` (Firebase popup compatible); COEP
  deliberately unset.
- **X-Content-Type-Options** `nosniff`; **Referrer-Policy**
  `strict-origin-when-cross-origin`; **X-Frame-Options** `DENY` (legacy
  fallback for `frame-ancestors`).
- **Permissions-Policy:** deny-all for 24 unused capabilities.
- **Preview vs production:** preview builds additionally allow the Vercel
  toolbar origins; dev/emulator builds relax `connect-src`/HSTS for local
  workflows only — the production policy is unaffected (A, D).

**Honest limitation:** `script-src` allows `'unsafe-inline'` because
Next.js App Router emits per-render inline bootstrap scripts that cannot
be hashed without forcing every page dynamic; this is a documented,
deliberate trade-off (see TECHNICAL.md). CSP here is defense in depth,
not XSS immunity.

## 11. Configuration and secrets (issue #54)

- **Centralized registry:** `src/lib/config/serverConfig.ts` is the
  canonical description of every consumed variable — classification
  (`public`/`server`/`secret`), per-environment required level, and a
  sanitized set/unset/invalid status that never exposes values (A, B).
- **Validation boundary:** checks run at explicit runtime boundaries —
  lazy validation on first use plus the sanitized status surface —
  **not** universal startup; the app builds and renders a clear
  "not configured" state without secrets (A, B, D — CI builds without
  secrets by design).
- **Firebase Admin secrets:** `FIREBASE_ADMIN_*` validated on use;
  private key format-checked; never logged (A).
- **`RATE_LIMIT_HASH_SECRET`:** required in deployed environments;
  current pilot evidence shows **zero** `rate_limit.secret_missing`
  events across the post-configuration deployments, consistent with the
  secret being present (D). When absent, the limiter deliberately fails
  open and logs loudly rather than hashing identifiers with a public
  salt (A, B).
- **`CRON_SECRET`:** production-required; cron routes fail closed without
  it (A, D — crons authenticate successfully on schedule).
- **Resend:** `RESEND_API_KEY` is a server-only secret, injected by the
  Vercel-managed Resend integration in deployed environments; sender
  identities are explicit `*_EMAIL_FROM` variables on the verified
  domain (A).
- **Canonical origin:** `NEXT_PUBLIC_APP_URL` validated; used for links
  in emails/QR codes (A, B).
- **Emulator-variable guard:** the Admin initializer refuses emulator
  mode in a deployed environment (A, B).

No secret values are printed, logged, or committed anywhere in this
assessment.

## 12. Abuse and rate limiting (ADR 0012)

- **Architecture:** fixed-window counters in Firestore (`rateLimits`
  collection, deny-all in rules); bucket keys are HMAC-SHA256 of
  `policy:identifier-type:value` under `RATE_LIMIT_HASH_SECRET` — raw IPs
  and identifiers are never stored or logged (A, B).
- **Protected surfaces:** `POST /api/auth/session` (50/5min per trusted
  IP), resident request creation (10/10min per UID), delivery
  confirm/dispute (20/10min per UID), request cancellation (20/10min per
  UID) (A, B).
- **Trusted origin:** client IP is trusted only when running behind
  Vercel (`VERCEL_ENV`), taken as the leftmost `x-forwarded-for` —
  spoofed headers cannot mint identities locally (A, B).
- **Fail-open mode (explicit, unchanged):** if the HMAC secret is missing
  in a deployed environment, the limiter logs `rate_limit.secret_missing`
  and **allows** the request — availability is deliberately preferred
  over blocking on a misconfiguration. Currently the pilot shows no such
  events (D). This is an architectural property to record, not a defect.
- **Known limitations:** fixed-window counters in a serverless fleet are
  approximate under concurrency and cold starts; the limiter is abuse
  friction, not a hard guarantee; Meta webhook traffic is not covered by
  this limiter (it relies on signature verification + processed-message
  idempotency).

## 13. Notifications and integrations (issue #53, ADR 0017)

- **Durable outbox:** notification intent is written inside the business
  transaction; a protected worker cron (`/api/cron/notifications`)
  claims due entries under a lease, sends via Resend, and retries with
  bounded backoff; terminal states are visible at `/admin/notifications`
  (A, B, C; D — cron returns 200 on schedule).
- **Precise semantics:** delivery is **at-least-once** bounded by
  Resend's idempotency-key de-duplication window — **not exactly-once**,
  not a guaranteed single provider call, and not absolute duplicate
  prevention across all provider failure modes.
- **Failure model:** a provider failure never rolls back committed
  delivery state, driver availability, or the 24-hour confirmation
  window; unconfigured Resend yields terminal `configuration_disabled`
  rather than infinite retry (A, C).
- **WhatsApp:** inbound webhook signature-verified; processed-message
  idempotency collection prevents replayed-message reprocessing (A, B).
  Live-provider acceptance remains an E item under #83.

## 14. Account merge and Auth reconciliation (issues #73, #95)

Security-sensitive; assessed separately.

- **Merge transaction:** single Firestore transaction reads fresh
  canonical + duplicate documents, computes the union-mode role set
  (`canonical ∪ (duplicate ∩ {resident, viewer})`), enforces last-admin
  and driver-registry invariants on the live transition, writes the merge
  audit event atomically, and marks the duplicate `mergedIntoUserId`
  (A, C).
- **Durable reconciliation:** `accountMergeEvents` carry reconciliation
  state (pending → disable → revoke tokens → delete Auth user), claimed
  under lease by the `/api/cron/merge-auth-reconciliation` cron with
  bounded retry; `user-not-found` is an idempotent success so
  crash-after-delete converges (A, C; D — cron 200 on schedule).
- **Session rejection:** a merged-away identity cannot mint a new session
  (403) and an existing cookie is rejected at the next verification —
  even while Auth deletion is still pending (C — both cases
  emulator-tested end-to-end).
- **Admin visibility:** reconciliation state is inspectable through admin
  surfaces; failures are logged, not silent (A).

## 15. Production diagnostics and smoke tooling

- **Integrity diagnostic (issue #52):** `scripts/production-integrity.mjs`
  is strictly read-only — explicit `--production` acknowledgement,
  explicit project target, bounded paginated reads (`--page-size`,
  `--max-records`, `--full-scan` opt-in), PII-safe output, and exit codes
  that never report a truncated run as clean (0 clean · 1 findings ·
  2 config/target failure · 3 truncated). It detects; it never remediates
  (A, B).
- **Production smoke (issue #84):** `scripts/production-smoke.mjs` is
  structurally GET/HEAD-only — no credentials, no mutation path — with
  `--production` acknowledgement, https + public-hostname validation,
  same-origin redirect policy with a redirect limit, per-request timeout,
  sanitized output (names/statuses/durations only — never bodies, headers
  upstream of the header check, or cookies), and deterministic exit codes
  (A, B). **Limitation:** it verifies HTTP surface and headers; it cannot
  see client-hydrated provider UI.

## 16. Testing and verification evidence

Executed against the assessed commit `eba8e2d`:

| Suite | Result | Level |
|---|---|---|
| `npm run check` (format, lint, typecheck, unit, build) | **831** unit/domain tests, production build | B |
| `npm run test:rules` (Firestore/Storage emulators) | **205** tests | C |
| `npm run test:auth-emulator` | **5** tests | C |
| `npm run test:e2e` (Playwright vs emulators) | **33** tests | C |
| `npm run docs:check-links` | 54 files, no broken links | B |
| `npm run smoke:production` vs live pilot | **7/7** GET-only checks | D |

**Emulator limitations (stated honestly):** emulator runs approximate,
not identical, production behavior — IAM, networking, cold starts,
provider quotas, real Auth provider flows, and real Resend/Meta delivery
are not exercised. Emulator green ≠ production verified; that distinction
is exactly what #83 staging acceptance exists to close.

## 17. Dependency and security scan

`npm audit` at the assessed commit: **17 advisories — 1 high, 16
moderate** (matches release-time state).

| Advisory | Severity | Reach | Fix status |
|---|---|---|---|
| `uuid` bounds check via google-gax / @google-cloud storage → `firebase-admin` 13.10.0 | moderate | **runtime**, transitive | Only fixed by firebase-admin 14.x, which currently breaks the Vercel serverless runtime (`ERR_REQUIRE_ESM` via `jwks-rsa`→`jose`); deferred to #94; no demonstrated exploit against this app |
| `js-yaml` merge-key CPU | high | dev-only (eslint, firebase-tools) | Compatible fix exists; not applied in the release window |
| `qs`/`express`/`body-parser`, `stream-json`, `csv-parse`, `@opentelemetry/core` | moderate | dev-only (firebase-tools) | Compatible or breaking-fixable; pending routine maintenance |

**Dependabot posture:** risk-class grouped updates with narrow ignores
for the known-incompatible major lines (`firebase-admin` 14.x,
`typescript` 7.x, `eslint` 10.x). Consequence, stated plainly: a fix that
exists **only** inside an ignored range will not auto-open a PR —
Dependabot alerts remain visible regardless, and #94 owns the Firebase
Admin retry. No dependency changes were made for this assessment.

## 18. Pilot verification performed (D)

All non-destructive, unauthenticated, GET/log-only:

- `smoke:production` 7/7 — health, readiness, home, login, security
  headers, manifest, service worker.
- Live response headers on `/login` — full enforcing CSP + companion
  header set confirmed (§10).
- Production runtime logs (post-rollback, post-index-fix deployments):
  `POST /api/auth/session` → 200s; `/api/cron/notifications` → 200 on a
  10-minute schedule with successful outbox processing;
  `/api/cron/merge-auth-reconciliation` → 200 on schedule; **zero**
  `ERR_REQUIRE_ESM`, `rate_limit.secret_missing`, or Firestore
  `FAILED_PRECONDITION` index errors on current-code deployments.
- **Not verified (cannot be, non-destructively):** real Google sign-in
  end-to-end, real email delivery to a resident, real WhatsApp inbound,
  authenticated portal flows — these require a session/test accounts and
  are precisely the #83 staging-acceptance scope.

## 19. Infrastructure and operational readiness (queried live)

| Gate | State | Why it matters |
|---|---|---|
| #56 Firebase/GCP ownership | **Open** | Data and Auth custody still on developer-owned project; audit-record integrity and recovery depend on it |
| #57 Vercel ownership | **Open** | Hosting, env vars, cron, and the managed Resend integration live under the developer's team |
| #58 Resend ownership | **Open** | Sender identity/credential transition to government control outstanding |
| #59 domain/DNS | **Open** | Pilot runs on `*.vercel.app`; official domain unestablished |
| #60 backups/PITR | **Open** | No verified backup/restore evidence yet |
| #61 government admins / break-glass | **Open** | No government-controlled admin path or break-glass procedure exercised |
| #62 monitoring/alerting | **Open** | No verified alerting for auth abuse, denied-traffic spikes, webhook/cron failures |
| #63 handover/recovery drill | **Open** | Handover unproven until the drill runs |
| #83 staging/live-provider acceptance | **Open** | Real-provider acceptance (OAuth, Resend delivery, WhatsApp) outstanding |
| #94 Firebase Admin 14 retry | **Open** | Owns the deferred dependency upgrade and its advisory tradeoff |

## 20. Residual risks

1. **Firebase Admin 13.10.0 transitive `uuid` advisory** — runtime-reachable
   in principle, moderate, no demonstrated exploit path in this app; the
   only fix (14.x) currently breaks deployment. Owned by #94.
2. **Dev-tool advisories** (js-yaml high, plus moderates) — dev-only
   reach; queued for routine maintenance.
3. **Real-provider acceptance pending** — Google OAuth, Resend delivery,
   WhatsApp webhook behavior verified only via emulators/code (E/#83).
4. **All infrastructure gates open** (#56–#63): custody, domain, backups,
   break-glass, monitoring, handover drill (F).
5. **Rate limiter fail-open** when `RATE_LIMIT_HASH_SECRET` is absent —
   deliberate availability-over-blocking choice; currently configured
   correctly, but the failure mode exists by design (A/D).
6. **Provider idempotency limits** — at-least-once notification delivery
   bounded by Resend's de-dup window; duplicate delivery is possible
   outside it (A).
7. **Emulator/production gap** — rules and reconciliation verified against
   emulators; deployed-rules parity is a console-verification item (F).
8. **Manual operational controls** — role administration, merges,
   dispatch overrides depend on human admin judgment; compensating
   controls (last-admin invariant, atomic audit) are in place.
9. **App Check unenforced** — assessed as acceptable given server-only
   data access; remains an optional hardening step requiring
   compatibility work before enforcement.
10. **CSP `'unsafe-inline'` in `script-src`** — deliberate Next.js
    trade-off; defense-in-depth value is reduced for script injection
    relative to a nonce/hash policy (A).
11. **Session-cookie horizon** — 5-day cookie lifetime; revocation
    checking mitigates disabled/merged users, but a stolen unexpired
    cookie for a still-valid user persists until expiry or revocation.

## 21. September 1 comparison

| Area | Sept 1 status | At v0.9.1 |
|---|---|---|
| Cron endpoint fail-open without secret | **Fixed** (fails closed) | Resolved — verified in code + pilot crons run authenticated (A, D) |
| Staff registration privileged-role escalation | **Fixed** (resident/driver only) | Resolved (A, B) |
| Viewer raw PII access | **Fixed** (deny + server projection) | Resolved (A, C) |
| Owner profile write allowlist | **Fixed** (4 fields) | Resolved (A, C) |
| Raw audit visibility to residents/drivers | **Fixed** (staff only) | Resolved (A, C) |
| Inactive photo metadata rules | **Fixed** (deny-all) | Resolved (A, C) |
| Collection reconciliation driver mismatch | **Fixed** | Resolved (A, C) |
| Missing browser security headers | **Fixed** (baseline set; CSP pending) | **Superseded** — full enforcing CSP now live (A, B, D) |
| `uuid` transitive advisory | Open — deferred pending Admin upgrade | Still open — same tradeoff, now tracked by #94 (accepted) |
| Configuration validation | Not yet centralized | **New** — centralized registry + sanitized status, boundary-scoped (#54) |
| Rate limiting | Absent | **New** — HMAC-keyed Firestore limiter on 4 abuse surfaces, fail-open mode documented (#32/#43, ADR 0012) |
| Notification durability | Best-effort | **New** — durable outbox, lease/retry, idempotency keys (#53) |
| Account merge Auth reconciliation | Absent | **New** — durable disable→revoke→delete with session rejection (#73) |
| Merge union role stripping | Bug not yet known | **Fixed** — incident found 2026-09-11, corrected with transaction-authoritative union (#95) |
| Production diagnostics | Absent | **New** — read-only bounded integrity scan (#52) |
| Production smoke | Absent | **New** — GET-only 7-check runner (#84) |
| Operational ownership, backups, monitoring, handover | Open | **Still open** — #56–#63, #83 (F) |
| Console-verification items (rules parity, authorized domains, IAM, MFA, alerting) | Open checklist | **Still open** — carried into #56–#63 acceptance (E/F) |

## 22. Recommended next gates

In dependency order for handover:

1. **#83** government staging environment + real-provider acceptance
   (Google OAuth, Resend delivery, WhatsApp, deployed rules parity).
2. **#56/#57/#58** custody transfer of Firebase/GCP, Vercel (incl. the
   managed Resend integration), and the sending domain.
3. **#59** official domain/DNS cutover (update `NEXT_PUBLIC_APP_URL`,
   Firebase authorized domains, QR codes).
4. **#60** backups/PITR enabled and restore tested.
5. **#61** government admin accounts + break-glass procedure verified.
6. **#62** monitoring/alerting for auth abuse, denied traffic, cron and
   webhook failures.
7. **#63** handover + recovery drill.
8. **#94** Firebase Admin 14 retry once Vercel packaging compatibility is
   resolved; routine Dependabot maintenance continues meanwhile.

## 23. Conclusion

Based on the evidence above: **the assessed `v0.9.1` codebase is
reasonably ready to proceed into government staging and handover
activities.** The code-level control set — authentication, session
integrity, authorization, rules, audit atomicity, headers, configuration
discipline, durable notification and merge-reconciliation machinery —
is implemented, unit/emulator-tested, and (where non-destructively
verifiable) observed healthy on the live pilot.

This is not a claim of government production acceptance. Custody of the
Firebase project, Vercel team, and Resend sender identity; official
DNS; verified backups and restore; government break-glass access;
monitoring; and live-provider staging acceptance all remain open gates.
No blocking defect was found in the assessed release, and no new issue
was required by this assessment.

---

*No production data was read beyond public/log surfaces, and none was
modified. No credentials, secret values, resident PII, or internal user
identifiers appear in this report.*
