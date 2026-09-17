# Firebase/GCP Ownership Handover

Runbook for moving the production Firebase/Google Cloud project from
developer-controlled pilot infrastructure to Public Entity
Saba-controlled infrastructure (issue
[#56](https://github.com/spizeck/saba-water-delivery/issues/56)).

> **Status.** This document is a plan and an operator runbook. Its
> existence does **not** transfer anything. Every step tagged
> **[OPERATOR]**, **[GOVERNMENT]**, or **[DEVELOPER]** is a human action
> performed in the Firebase/Google Cloud consoles, with `gcloud`/
> `firebase`, or in Vercel — never by this repository. Steps tagged
> **[VERIFY]** confirm a state before proceeding; **[STOP/ROLLBACK]**
> marks a decision point. Nothing here is executed automatically.
>
> **Safety.** Do not delete or revoke anything until its replacement is
> verified working. Do not perform a destructive step without the
> verified backup/export described in §4. Never record credential values,
> key IDs beyond the last few characters, or personal data in tickets,
> logs, or this document.

---

## 1. Purpose

What is being transferred, and why:

- **The Firebase/GCP project itself** (`saba-water-delivery`) — IAM,
  billing, and organizational control — so Public Entity Saba can
  administer authentication, data, and recovery without the original
  volunteer developer.
- **The runtime service-account credential** the deployed application
  uses (`FIREBASE_ADMIN_*`), so a developer-controlled key cannot
  silently retain full access after handover.
- **Console-owned configuration** the repository cannot represent:
  Firebase Auth providers and authorized domains, Firestore TTL
  policies, backup/PITR settings, API enablement, and quotas.

Out of scope here (covered by sibling issues — see §15): Vercel
ownership and environment variables (#57), Resend (#58), DNS/custom
domain (#59), enabling backups/PITR (#60), government administrator
provisioning and break-glass (#61), monitoring (#62), the final handover
drill (#63), and real-provider staging acceptance (#83).

## 2. Current architecture (repository-verifiable)

Everything in this section is provable from the repository. Everything
in §3 is not.

### Project and database

| Item | Value / state | Evidence |
| --- | --- | --- |
| Firebase project ID | `saba-water-delivery` | [`.firebaserc`](../.firebaserc) `projects.default` — a public identifier, not a secret |
| Emulator project ID | `demo-saba-water-delivery` | `package.json` test scripts, `e2e/support/config.ts`; `demo-` projects are disposable and never real |
| Firestore database | `(default)`, declared location `nam5` | [`firebase.json`](../firebase.json) `firestore.database` / `firestore.location` |
| Named-database override | `FIREBASE_DATABASE_ID` — unset in normal operation; disaster-recovery failover only | [`.env.example`](../.env.example), [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §6.8 |
| Firestore Security Rules | `firestore.rules` — deny-by-default; all operational writes are server-only | repo root |
| Storage Security Rules | `storage.rules` — deny-all scaffold; photo features not implemented | repo root |
| Composite indexes | `firestore.indexes.json` — `notificationOutbox`, `accountMergeEvents`, `driverOffers`, `waterRequests` | repo root |
| Firestore TTL policy | `rateLimits.expiresAt` — a **manual, console/gcloud-only** setting; not represented in `firebase.json` | [`DEPLOYMENT.md`](./DEPLOYMENT.md) "Firestore TTL" |
| Firebase Functions | **None.** Scheduling is Vercel Cron: `/api/cron/continuity-report` (daily 00:00 UTC), `/api/cron/notifications` (every 10 min), `/api/cron/merge-auth-reconciliation` (hourly) | [`vercel.json`](../vercel.json) |
| Firebase Storage | Bucket provisioned (`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`). Repository evidence shows **no active application Storage workflow** — `storage.rules` is deny-all and no code path reads or writes Storage — so the application is not expected to store production objects. The repo cannot prove the live bucket's contents: the **console inventory is the source of truth** (verify in §5) before any handover or deletion decision | `storage.rules`, `TECHNICAL.md` |

### Authentication

- **Providers implemented:** Google (`signInWithPopup`) and
  email/password. Facebook is scaffolded but hard-disabled in the login
  UI (`src/app/login/LoginForm.tsx`) — enabling it is a reviewed app
  change plus console work, not part of this handover.
- **Session model:** the client exchanges a Firebase ID token at
  `POST /api/auth/session`; the server verifies it with
  `checkRevoked: true` and mints an httpOnly session cookie (5-day max
  age). Every request re-verifies the cookie with revocation checking
  and re-reads roles from Firestore. See
  [`SECURITY_REPORT.md`](../SECURITY_REPORT.md) §5.
- **Admin SDK Auth usage:** `verifyIdToken`, `createSessionCookie`,
  `verifySessionCookie`, `getUser` (session route); user disable,
  refresh-token revocation, and deletion (account-merge reconciliation,
  ADR 0018, hourly cron).
- **Session cookies are project-signed.** Any change that replaces the
  Firebase project (Option B) or fully rotates the underlying token
  signing keys invalidates all live sessions — users simply sign in
  again; no data is lost.

### Credentials the application consumes (names only — never values)

Classification legend: **public** = build-time inlined, visible in the
browser by design; **server** = server-only non-secret; **secret** =
server-only, must never reach the browser, logs, or tickets.

| Variable | Purpose | Consumer | Class | Rotate/recreate at handover? | Stored in | Vercel update + redeploy? |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client SDK API key | Browser | public | Only if moving to a **new** project (Option B). Also verify console API-key restrictions (§5) | Vercel env | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client auth origin; feeds CSP | Browser | public | Option B only (new `<project>.firebaseapp.com`) | Vercel env | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client SDK | Browser | public | Option B only | Vercel env | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client SDK | Browser | public | Option B only | Vercel env | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client SDK (unused today) | Browser | public | Option B only | Vercel env | Yes (build) |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client SDK (unused today) | Browser | public | Option B only | Vercel env | Yes (build) |
| `FIREBASE_ADMIN_PROJECT_ID` | Admin SDK project | Server | server | Option B only (new project id) | Vercel env | Yes |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Service-account identity | Server | server | **Yes in both options** — new government-created service account | Vercel env | Yes |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Service-account private key | Server | **secret** | **Yes in both options** — generate a new key; the old one is eventually deleted, not copied | Vercel env | Yes |
| `FIREBASE_DATABASE_ID` | Named-DB DR override | Server | server | No — should be **unset** in normal operation; verify it is unset | Vercel env | Only if set |
| `CRON_SECRET` | Authorizes cron routes | Server (Vercel Cron) | **secret** | Not Firebase-owned, but rotate in the same window — cheap and removes developer knowledge of it | Vercel env | Yes |
| `RATE_LIMIT_HASH_SECRET` | HMAC salt for limiter keys | Server | **secret** | Same reasoning as `CRON_SECRET` (rotation resets in-flight windows — harmless) | Vercel env | Yes |

Non-Firebase application secrets (`RESEND_API_KEY`, `WHATSAPP_*`, email
sender variables) are #57/#58 scope — listed in
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §10.

### Operator scripts that consume Firebase credentials

These run on an administrator's machine, never in CI or Vercel:

| Script | Credential source | Mutates? |
| --- | --- | --- |
| `scripts/verify-recovery.mjs` (`npm run verify:recovery`) | `GOOGLE_APPLICATION_CREDENTIALS` file path or `--service-account-file` | No (read-only validator) |
| `scripts/production-integrity.mjs` (`npm run diagnose:integrity`) | Same | No (read-only diagnostic; `--production` gated) |
| `scripts/migrate-villages.mjs` | `FIREBASE_ADMIN_*` env | Dry-run default; `--write` mutates |
| `scripts/reconcile-stale-driver-locks.mjs` | `FIREBASE_SERVICE_ACCOUNT_KEY` (full JSON — a **different** variable name) | Dry-run default; `--write` mutates |
| `scripts/test-concurrency.ts` | `FIREBASE_ADMIN_*` env | Test script |

After credential rotation, any developer-held key file used with these
scripts stops working — that is intended.

### Required GCP APIs (inferred — verify in console, §5)

The code paths imply these APIs must be enabled: Firestore
(`firestore.googleapis.com`), Identity Toolkit
(`identitytoolkit.googleapis.com` — Firebase Auth, including session
cookies), Secure Token (`securetoken.googleapis.com` — token refresh,
referenced in CSP), Firebase Management/Rules
(`firebase.googleapis.com`, `firebaserules.googleapis.com` — console +
`firebase deploy`), and Cloud Storage APIs (bucket provisioned). The
repository cannot see API enablement; confirm each shows **Enabled** in
the console.

## 3. What the repository cannot prove — console verification required

The repository proves the project **ID** and every config file above. It
cannot prove who controls the project. Per the issue context the pilot
runs on developer-owned infrastructure, but the following are
**operator-verification items**, marked **[OPERATOR]** in §5:

- Organization placement, project ownership, and project number.
- Billing account ownership and plan (Spark vs Blaze — **Blaze is
  required** for PITR, scheduled backups, and export; this gates #60).
- Every IAM principal and role on the project.
- Service accounts, their keys, key ages, and which keys are deployed.
- Firebase Auth provider configuration, OAuth consent settings, and
  **authorized domains**.
- The actual Firestore database ID, location, type (Native mode), and
  whether PITR/scheduled backups/TTL are enabled.
- API enablement, quotas, and any alerting/budgets.
- Whether any other Firebase surface (Hosting, App Check, Dynamic Links,
  Analytics, Crashlytics, Cloud Messaging) is enabled in the console.

Do not write findings containing secrets into this document or GitHub;
record categorical facts only (see §14).

## 4. Preconditions — before touching anything

All must hold before the transfer session begins:

1. **[GOVERNMENT]** At least two Public Entity Saba technical
   administrators are identified, each with a Google identity under
   government control (a government-managed Google Workspace/Cloud
   Identity account, or an agreed alternative). This is #61's scope —
   this runbook consumes its output.
2. **[GOVERNMENT]** A government-controlled billing arrangement exists
   (billing account, or a decision on who pays), approved for any
   billable features the project needs (Blaze for backups per #60).
3. **[GOVERNMENT/DEVELOPER]** The migration approach is decided:
   **Option A (transfer control of the existing project)** or **Option B
   (new government-owned project)** — see §6. Default to Option A unless
   §5 verification shows a blocker.
4. **[DEVELOPER]** The current application release is recorded — the
   deployed `main` SHA and release tag (`v0.9.1` at time of writing).
5. **[OPERATOR]** A rollback owner is named, and a maintenance window is
   agreed if Option B is chosen (Option A needs no downtime).
6. **[OPERATOR]** **Data safeguard before any change — depends on the
   #60 export bucket.** The canonical private, least-privilege,
   government-controlled export bucket is provisioned under #60 (see
   [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §4); this runbook
   deliberately does not design a second backup scheme.

   - **If #60 has already established the bucket:** record its name and
     take an on-demand managed export — the documented
     pre-risky-change habit in
     [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §2, item 3:

     ```bash
     gcloud firestore export gs://<BACKUP_BUCKET>/pre-handover-<YYYYMMDD> \
       --database='(default)' --project=saba-water-delivery
     ```

   - **If #60 has NOT established one: [STOP/ROLLBACK]** — do not begin
     the risky ownership/credential steps that rely on this safeguard
     until the bucket exists. For reference, a Firestore managed-export
     destination minimally requires: the Blaze plan, a private bucket
     (no public access) reachable from the project, and the project's
     Firestore service agent
     (`service-<PROJECT_NUMBER>@gcp-sa-firestore.iam.gserviceaccount.com`)
     holding `roles/storage.admin` on that bucket. Provisioning a
     durable bucket meeting those prerequisites is #60's decision —
     never improvised inside the handover session.
7. **[OPERATOR]** A manual Firebase Auth export is taken per
   [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §7 (contains password
   hashes and PII — handle as a secret, store on an administrator's
   trusted machine only, delete when the handover is verified). This
   step is **mandatory for Option B** (it is the Auth migration
   mechanism) and **recommended for Option A** (point-in-time identity
   record before IAM changes).

## 5. Pre-transfer verification (console checklist)

Performed by the current project owner **[DEVELOPER]** together with
government IT **[GOVERNMENT]**, in the Firebase console and Google Cloud
console. Record results categorically in the handover record (§14).

- [ ] **[OPERATOR]** Project `saba-water-delivery`: project number,
      organization (none / which), and folder placement.
- [ ] **[OPERATOR]** IAM → list every principal and role; identify every
      non-government principal.
- [ ] **[OPERATOR]** Billing → current billing account and owner; plan
      type (Spark/Blaze). If Spark and #60 needs backups, plan the Blaze
      upgrade.
- [ ] **[OPERATOR]** IAM → Service accounts: list all; for each, note
      purpose, keys, key ages. Identify which key backs production
      `FIREBASE_ADMIN_*` (match `client_email`; the private key itself is
      never inspectable).
- [ ] **[OPERATOR]** Firebase → Authentication → Sign-in method: which
      providers are enabled (expect Google + Email/Password; Facebook
      expected disabled).
- [ ] **[OPERATOR]** Firebase → Authentication → Settings → **Authorized
      domains**: record the list. Expected: `localhost`,
      `<project>.firebaseapp.com`, and `saba-water-delivery.vercel.app`.
      Note any unexpected entries; #59 adds the official domain later.
- [ ] **[OPERATOR]** Google Cloud console → APIs & Services → OAuth
      consent screen: app name, support email, publishing status. These
      are console-only settings that must carry over or be recreated.
- [ ] **[OPERATOR]** Firestore → database list: confirm the app serves
      `(default)` (check `FIREBASE_DATABASE_ID` in Vercel — expected
      unset); record location (`nam5` declared) and Native mode.
- [ ] **[OPERATOR]** Firestore → the `rateLimits` TTL policy state on
      `expiresAt` (recreate if absent — see
      [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- [ ] **[OPERATOR]** Firestore → Backups: PITR enablement and any
      scheduled-backup schedules (probably absent — #60 enables them).
- [ ] **[OPERATOR]** APIs & Services → Enabled APIs: compare against the
      §2 inferred list.
- [ ] **[OPERATOR]** APIs & Services → Credentials: the browser API key
      (`NEXT_PUBLIC_FIREBASE_API_KEY` value's corresponding key) —
      check whether it has application/API restrictions; recommend
      restricting it to the Firebase APIs in use with HTTP-referrer
      restrictions for the production origin(s).
- [ ] **[OPERATOR]** Quotas and any budgets/billing alerts (#62 consumes
      this for monitoring).
- [ ] **[OPERATOR]** Storage: inventory the provisioned bucket's objects
      in the console — the source of truth for whether production
      objects exist (the repository cannot prove this; §2 is
      application inference only). Record the finding before any
      handover or deletion decision.
- [ ] **[OPERATOR]** Other Firebase surfaces enabled in the console
      (Hosting, Analytics, App Check, etc.) — record for completeness.

## 6. Migration approach — Option A vs Option B

### Option A — transfer control of the existing project (preferred)

Keep project `saba-water-delivery`; change who controls it.

- Firestore data, indexes, rules, and TTL stay exactly where they are.
- Firebase Auth users and **UIDs are untouched** — no identity
  migration, no re-linking `users/{uid}` documents, no session
  invalidation beyond normal expiry.
- No application cutover, no Vercel client-config change, no downtime.
- Government control = IAM principals + billing account (+ optionally
  moving the project into a government Google Cloud Organization or
  Cloud Identity resource — `resourcemanager.projects.move` requires
  org-level permissions; treat as optional hardening, not a blocker).
- Constraints that could block it (§5 detects these): billing cannot be
  moved to a government account; the project is entangled in a personal
  organization with policies that cannot accept government
  administrators; or government policy requires a fresh, government-born
  project boundary.

### Option B — migrate to a new government-owned project

Create `saba-water-delivery` (or a new ID) under government control and
move everything:

- Firestore: export from old project → import into the new project's
  database (new database, new location choice — `nam5` or an approved
  region; **location is permanent once chosen**).
- Auth: `firebase auth:export` → `auth:import` with the console's
  password-hash parameters preserves UIDs and email/password
  credentials; Google identities re-verify on next sign-in. Session
  cookies are project-signed — **every live session ends** and users
  sign in again.
- New service account + new `FIREBASE_ADMIN_*`; **new**
  `NEXT_PUBLIC_FIREBASE_*` (API key, auth domain, project ID, app ID) →
  Vercel update + redeploy.
- Recreate authorized domains, OAuth consent, providers, TTL policy,
  indexes, rules; validate against the new project.
- Cutover is a real migration: freeze writes (or accept divergence),
  migrate, verify, repoint, smoke-test. Rollback = repoint Vercel env
  back to the old project, which must be retained until sign-off. This
  is the only option needing a maintenance window.

### Decision

**Recommend Option A** unless §5 finds a blocker or Public Entity Saba
policy requires a government-born project. Option A preserves UIDs,
data, sessions, and availability with materially less risk; Option B's
only advantage is a clean ownership boundary, which Option A can also
reach by removing all non-government principals. **[GOVERNMENT]** makes
this decision after §5 verification; this runbook does not assume it.

## 7. IAM transfer procedure (Option A)

Human-executed, additive-first. **Never remove access before the
replacement is verified.**

1. **[GOVERNMENT]** Add the two government administrator identities to
   the project. Steady-state administration of Auth, Firestore, rules,
   and IAM realistically requires broad privileges — grant
   `roles/owner` to the designated leads, or, where the organization
   prefers least privilege, `roles/editor` plus
   `roles/firebaseauth.admin` and `roles/datastore.owner` covers
   day-to-day Auth/Firestore administration while reserving Owner for
   IAM/billing changes. Record the choice. Do not spread Owner widely.
2. **[GOVERNMENT]** Enable MFA on every administrator account; record
      MFA enrollment categorically (not the method secrets).
3. **[GOVERNMENT]** Move billing to the government-controlled billing
   account (console → Billing → change billing account). Requires
   billing-admin rights on the target account.
4. **[OPERATOR]** (Optional hardening) Move the project into the
   government Cloud Organization if one exists.
5. **[VERIFY]** Each government administrator can open the Firebase
   console, view IAM, and open Authentication and Firestore.

## 8. Runtime credential rotation

Goal: the deployed application runs on a **government-created**
service-account credential, and no developer-held key retains access.

1. **[OPERATOR]** In the (now government-controlled) project, create a
   dedicated service account for the application runtime — e.g.
   `saba-water-app-runtime` — rather than reusing the console-default
   `firebase-adminsdk` account.
2. **[OPERATOR]** Grant it the preferred minimum project-level role
   set — each role covers a distinct permission the code paths require:

   | Role | Permission it covers | Used by |
   | --- | --- | --- |
   | `roles/datastore.user` | Firestore document reads/writes | Every server data path — portals, crons, webhooks |
   | `roles/firebaseauth.admin` | Firebase Auth user management | `verifyIdToken`/`createSessionCookie`/`verifySessionCookie`, `getUser`, and merge-reconciliation disable/revoke/delete |
   | `roles/serviceusage.serviceUsageConsumer` | `serviceusage.services.use` — consume the project's enabled Google Cloud APIs (quota/billing attribution) | Every Google API call the Admin SDK makes |

   The third role is easy to miss: `serviceusage.services.use` is
   inherited implicitly by broad roles like Owner/Editor — which is why
   the console-default `firebase-adminsdk` account (typically granted
   `roles/editor`) never hits this failure — but a purpose-built
   least-privilege account does not inherit it. Without it, Admin SDK
   calls fail with `PERMISSION_DENIED` / `USER_PROJECT_DENIED` (this is
   a documented, observed failure mode against
   `identitytoolkit.googleapis.com`). Grant it explicitly unless §5
   verification shows an equivalent permission is already inherited —
   e.g. from an organization-level grant — in which case record the
   equivalence rather than granting twice.

   Do **not** fall back to `roles/editor` for convenience. If
   verification shows a further permission is required, add the
   narrowest role that resolves it.
3. **[OPERATOR]** Generate a **new** private key on that service
   account. Deliver the JSON to whoever sets Vercel variables over a
   secure channel (government-approved vault/share) — **never** through
   GitHub, email, or chat.
4. **[GOVERNMENT]** (whoever owns Vercel at execution time — coordinate
   with #57) Update `FIREBASE_ADMIN_CLIENT_EMAIL` and
   `FIREBASE_ADMIN_PRIVATE_KEY` in the Vercel **Production** and
   **Preview** environments; leave `FIREBASE_ADMIN_PROJECT_ID`
   unchanged under Option A.
5. **[OPERATOR]** Trigger a redeploy (env changes require one) and
   immediately run verification (§11).
6. **[STOP/ROLLBACK]** If verification fails, restore the previous
   `FIREBASE_ADMIN_*` values in Vercel and redeploy — the old key is
   still valid because nothing has been deleted yet. Diagnose before
   retrying.
7. **[VERIFY]** Confirm the new account is actually serving before any
   revocation: the §11 checks exercise each required permission —
   readiness + cron runs prove Firestore writes (`datastore.user`), a
   real sign-in proves session-cookie minting (`firebaseauth.admin`),
   and the absence of `PERMISSION_DENIED`/`USER_PROJECT_DENIED` errors
   proves `serviceusage.services.use`. Confirm in IAM → Service
   accounts that the application authenticated as the new account
   (last-used timestamps / audit logs), then proceed to §13 for
   old-credential removal.

## 9. Firebase Auth verification

- [ ] **[VERIFY]** Sign-in providers match §5 expectations (Google +
      Email/Password enabled; Facebook disabled).
- [ ] **[VERIFY]** Authorized domains still contain every serving
      origin (`saba-water-delivery.vercel.app` now; the official domain
      arrives with #59 — removing `localhost` is optional hygiene).
- [ ] **[VERIFY]** OAuth consent screen shows a government-appropriate
      support email/app identity (update if it still names the
      developer).
- [ ] **[VERIFY]** A real Google sign-in completes and a session cookie
      is established (one signed-in test is enough; the full
      real-provider matrix is #83).
- [ ] **[VERIFY]** A merged-away test identity (if one exists) is still
      rejected at session creation — the durable
      `mergedIntoUserId` boundary survives unchanged because data did
      not move (Option A).

## 10. Firestore verification

- [ ] **[VERIFY]** Database `(default)` in `nam5` serves the app;
      `FIREBASE_DATABASE_ID` unset in Vercel.
- [ ] **[VERIFY]** `gcloud firestore indexes list` output matches
      `firestore.indexes.json` (all indexes present, state `READY`).
- [ ] **[VERIFY]** Deployed rules equal the repository files:

  ```bash
  firebase deploy --only firestore:rules,storage --project=saba-water-delivery
  ```

  An authorized operator may deploy rules/indexes to guarantee parity —
  the repository files are canonical:

  ```bash
  firebase deploy --only firestore:rules --project=saba-water-delivery
  firebase deploy --only firestore:indexes --project=saba-water-delivery
  firebase deploy --only storage --project=saba-water-delivery
  ```

  Deploying identical definitions is a no-op; do it only if §5 found a
  parity doubt, and note that index creation takes minutes. (On
  2026-09-16, during preparation of this runbook, the existing
  unchanged `firestore.rules`, `firestore.indexes.json`, and
  `storage.rules` were redeployed to `saba-water-delivery` and accepted
  cleanly — production parity confirmed at that date; re-verify at
  handover time.)
- [ ] **[VERIFY]** `rateLimits` TTL policy on `expiresAt` is enabled
      (recreate per DEPLOYMENT.md if not).
- [ ] **[VERIFY]** Spot-check the inventory from
      [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §1: `users`
      roles, `driverRegistry` (+events/meters), `waterRequests`
      (+events), `dispatchBatches`, `config/dispatchSettings`,
      `fillStations`, `accountMergeEvents`, `notificationOutbox`,
      `systemInvariants`. Under Option A nothing moved — this is a
      regression check, not a migration check.
- [ ] **[VERIFY]** Run the read-only integrity diagnostic against
      production (deliberate `--production` gate):

  ```bash
  npm run diagnose:integrity -- --production --project=saba-water-delivery
  ```

## 11. Application verification

After any credential rotation or IAM change, in this order:

1. **[VERIFY]** `curl -i https://saba-water-delivery.vercel.app/api/health` → 200.
2. **[VERIFY]** `curl -i https://saba-water-delivery.vercel.app/api/readiness` →
   `ready` (a 503 here means the app cannot reach Firestore — the first
   signal a rotated credential is wrong).
3. **[VERIFY]** Non-destructive smoke — GET-only, cannot mutate:

   ```bash
   npm run smoke:production -- --url https://saba-water-delivery.vercel.app --production
   ```

4. **[VERIFY]** One real sign-in per §9; a dispatcher or admin portal
   loads for a staff test account.
5. **[VERIFY]** The hourly `merge-auth-reconciliation` and 10-minute
   `notifications` crons return 200 on their next scheduled runs (Vercel
   → Logs), proving the new service account can manage Auth users and
   write Firestore.
6. The full resident/driver/dispatcher/admin smoke from
   [`TESTING.md`](./TESTING.md) and the real-provider acceptance are the
   #83/#63 scope — note what was and was not exercised here.

## 12. Rollback procedure

| Change | Reversible? | Rollback |
| --- | --- | --- |
| Adding government IAM principals | Yes | Remove the added principals (do not do so merely to roll back — prefer fixing forward) |
| Billing account change | Yes | Reattach the previous billing account |
| Moving project into an organization | Mostly | Move back requires equivalent permissions on the destination — do not move casually |
| New service account + Vercel `FIREBASE_ADMIN_*` | **Yes, cleanly** | Restore previous env values in Vercel, redeploy — valid while the old key still exists |
| Deleting the old service-account key | **No** | Irreversible — the reason it is last and gated on verification |
| Removing developer IAM | Yes in effect | Re-add the principal — but each remove/re-add should be deliberate, not routine |
| Option B cutover | Yes while old project lives | Repoint `NEXT_PUBLIC_FIREBASE_*` + `FIREBASE_ADMIN_*` to the old project and redeploy; sessions still break once (users re-login) |
| Deleting the old project (Option B) | **No** | Never delete until #63 acceptance plus an agreed retention period |

**The ordering rule:** rotation before revocation, always. The old
credential must remain valid until the new credential is proven serving
production traffic.

## 13. Developer access removal — only after government acceptance

Sequence, each gated on the previous:

1. **[GOVERNMENT]** Government administrators confirm they can perform
   the §5–§11 checks without developer help.
2. **[OPERATOR]** Confirm the new runtime credential has served
   production (cron 200s + smoke pass) for a soak period — at least one
   full cron day is reasonable.
3. **[OPERATOR]** Delete the superseded service-account **keys** (not
   necessarily the account) — the ones backing the old
   `FIREBASE_ADMIN_PRIVATE_KEY` and any stray keys on developer-created
   service accounts. **[STOP/ROLLBACK]** point: after this, rollback to
   the old credential is impossible.
4. **[OPERATOR]** Remove the developer's project IAM roles **except**
   whatever minimal support role the government explicitly approves
   (e.g. a time-boxed support arrangement under #61). Remove any other
   non-government principals found in §5.
5. **[GOVERNMENT]** Rotate `CRON_SECRET` and `RATE_LIMIT_HASH_SECRET` in
   Vercel (developer knowledge of them ends here) — coordinate with #57.
6. **[VERIFY]** Final §11 application verification.
7. Record everything per §14.

## 14. Evidence to retain (handover record)

Keep a dated record (a shared government ops document or an issue
comment — categorical facts only, **no secrets, no key material, no
resident PII**):

- Date/time and operators present (government + developer).
- Project ID and project number; chosen option (A/B) and why.
- IAM state before and after (principal list, roles — names/emails of
  principals are acceptable; secrets are not).
- Deployed application release SHA/tag verified.
- Credential rotation confirmed (new service-account `client_email`
  prefix is fine; never the key ID beyond a fragment, never the key).
- Verification results: §9–§11 checklists, smoke output summary.
- Billing account change confirmation.
- Old keys deleted / principals removed (dates).
- Outstanding exceptions and follow-ups.

## 15. Relationship to other issues

| Issue | Boundary |
| --- | --- |
| **#57** Vercel ownership | Owns Vercel team/project transfer and the env-var custody itself. This runbook names which variables change and when, but executing the Vercel changes is shared/#57 work. |
| **#58** Resend | Sender identity and `RESEND_API_KEY` — untouched here. |
| **#59** Domain/DNS | Adds the official authorized domain + `NEXT_PUBLIC_APP_URL` update after this handover. |
| **#60** Backups/PITR | Owns enabling PITR/scheduled backups. This runbook requires their state known and uses the §2 on-demand export habit as the pre-change safeguard — it does not design backups. |
| **#61** Admins/break-glass | Owns who the government administrators are and emergency recovery. This runbook consumes its administrator list; break-glass is not duplicated here. |
| **#62** Monitoring | Consumes the §5 quota/billing-alert findings. |
| **#63** Handover drill | The acceptance gate this runbook feeds. |
| **#83** Staging acceptance | Needs a government-owned Firebase project — an output of this issue. Staging may be provisioned as a sibling project alongside production once government ownership exists. |

## 16. Security considerations

- **Least privilege:** runtime service account scoped to
  `datastore.user` + `firebaseauth.admin`; human administrators hold
  Owner/Editor only as needed for IAM/billing; no standing broad access
  for operators who only read data.
- **Two-person continuity:** two government administrators minimum, both
  able to reach IAM, billing, Auth, and Firestore — no single-person
  dependency replaces the old one.
- **Credential rotation before revocation** (§12 ordering rule); the
  superseded key is deleted only after the new one proves itself.
- **No credential transit through GitHub, chat, or email** — keys move
  through a government-approved secure channel; env values are typed
  into Vercel directly.
- **No secrets in evidence** — §14 records categorical facts.
- **Rollback access during cutover:** the old credential and developer
  access stay live until verification passes; plan for this overlap as
  an accepted, time-boxed exposure, not an accident.
- **Audit trail:** IAM and key changes appear in Google Cloud audit
  logs where the project/org has them enabled; note availability in the
  handover record.

---

## Handover session checklist

A condensed checklist for the maintenance session itself. Tags:
**[GOVERNMENT]** government IT/admin · **[OPERATOR]** whoever holds
console access executing the step · **[DEVELOPER]** current project
owner · **[VERIFY]** confirmation gate · **[STOP/ROLLBACK]** decision
point.

### Before the session

- [ ] **[GOVERNMENT]** Two government admins identified; Google
      identities exist; MFA enabled. (feeds from #61)
- [ ] **[GOVERNMENT]** Billing arrangement approved (Blaze if backups
      needed — #60).
- [ ] **[GOVERNMENT/DEVELOPER]** Option A vs B decided after a §5-style
      inspection.
- [ ] **[DEVELOPER]** Release SHA/tag recorded.
- [ ] **[OPERATOR]** Canonical #60 export bucket confirmed to exist —
      **[STOP/ROLLBACK]** the session if it does not (§4.6).
- [ ] **[OPERATOR]** Pre-handover Firestore export taken (§4.6); Auth
      export taken and secured (§4.7).
- [ ] **[OPERATOR]** §5 console checklist completed and recorded.

### Transfer session (Option A)

- [ ] **[OPERATOR]** Government admins added to project IAM (§7.1).
- [ ] **[OPERATOR]** Billing moved to government account (§7.3).
- [ ] **[OPERATOR]** New dedicated runtime service account created with
      least-privilege roles; new key generated and delivered securely
      (§8.1–8.3).
- [ ] **[GOVERNMENT/OPERATOR]** Vercel `FIREBASE_ADMIN_*` updated; app
      redeployed (§8.4–8.5) — coordinate with #57 if Vercel transfer
      hasn't happened yet.
- [ ] **[VERIFY]** §11 application verification passes (health,
      readiness, smoke, sign-in, cron 200s).
- [ ] **[STOP/ROLLBACK]** If anything fails: restore previous
      `FIREBASE_ADMIN_*`, redeploy, diagnose (§12).
- [ ] **[VERIFY]** §9 Auth checks (providers, authorized domains, OAuth
      consent, real sign-in).
- [ ] **[VERIFY]** §10 Firestore checks (indexes `READY`, rules parity,
      TTL, integrity diagnostic clean).
- [ ] **[OPERATOR]** Soak period observed (≥ one cron day).

### After acceptance

- [ ] **[OPERATOR]** Superseded service-account keys deleted (§13.3 —
      **irreversible**).
- [ ] **[OPERATOR]** Developer IAM reduced to the agreed support role;
      other non-government principals removed (§13.4).
- [ ] **[GOVERNMENT]** `CRON_SECRET` + `RATE_LIMIT_HASH_SECRET` rotated
      (§13.5).
- [ ] **[VERIFY]** Final §11 verification.
- [ ] **[GOVERNMENT]** §14 handover record written; exceptions filed as
      follow-up issues.
- [ ] **[GOVERNMENT]** #56 acceptance criteria reviewed; remaining gates
      (#60–#63) confirmed still tracked.
