# Disaster Recovery: Backup and Restore

This is the **canonical source of truth for backing up and recovering the Saba
Water Delivery *data***. It is written so a future Public Entity Saba IT staff
member can operate it **without the original developer**.

Saba Water Delivery was developed on a volunteer basis for the Public Entity
Saba and is intended to be handed over for government operation (see
[`README.md`](../README.md) "Project Provenance and Handover"). Backup and
recovery ownership must therefore live with the government project owners and
their Firebase/Google Cloud and Vercel account administrators — not with the
volunteer developer.

**Scope split — read this first.** This document covers **data durability**:
backups, restores, and disaster recovery of the database and identities. It is
distinct from [`INCIDENT_RECOVERY.md`](./INCIDENT_RECOVERY.md), which covers
**availability** (keeping deliveries moving during a website/Firebase/Vercel/
WhatsApp outage, and handling a suspected security incident). When an incident
involves **lost or corrupted data**, `INCIDENT_RECOVERY.md` points here.

> **Status.** This document defines the strategy and the exact operator steps.
> It does **not**, by itself, enable any cloud backup. Every item marked
> **[OPERATOR ACTION REQUIRED]** must be performed by a project administrator in
> the Google Cloud / Firebase console or with `gcloud`/`firebase` before the
> protection it describes is actually active. Do not assume backups exist
> because this file does.

---

## 1. What must be recovered (persistent-state inventory)

The authoritative production data lives in **Firebase / Google Cloud** for the
`saba-water-delivery` project (the project id is recorded in
[`.firebaserc`](../.firebaserc) and is not a secret). Everything else the app
needs is either in Git or in a vendor console.

### Firestore collections

| Collection | Contents | Classification |
| --- | --- | --- |
| `users` (+ subcollections `roleEvents`, future `propertyPhotos`) | Resident/driver/staff profiles, roles, role-change history. Contains PII (name, email, phone, village, directions). | **Business-critical, security-sensitive** |
| `waterRequests` (+ subcollections `events`, future `photos`) | Every water request, its status, customer snapshot (PII), and the per-request audit trail. | **Business-critical, security-sensitive** |
| `driverRegistry` (+ subcollections `events`, `meters`) | Government-managed driver roster, eligibility/availability, `activeRequestId` lock, meter assignments, driver history. | **Business-critical** |
| `driverRegistryUniqueKeys` | Uniqueness index for the driver registry. | Business-critical (reconstructable from `driverRegistry`, but back it up with everything else) |
| `dispatchBatches` (+ subcollection `events`) | Delivery Runs and their history. | **Business-critical** |
| `driverOffers` | One-at-a-time dispatch offers. | Mostly transient; has short-term audit value |
| `config` (doc `dispatchSettings` + subcollection `events`) | Admin-configurable dispatch settings and change history. | **Business-critical** (small; also seed-able) |
| `fillStations` | Fill-station list. | Reconstructable/seed-able (small, rarely changes) |
| `accountMergeEvents` | Audit trail of admin account merges. | **Business-critical audit** |
| `rateLimits` | Fixed-window rate-limit counters. | **Ephemeral / disposable** — self-healing, TTL-expired |
| `whatsappSessions` | WhatsApp conversation scratch state. | **Ephemeral / disposable** — explicitly scratch state |
| `whatsappProcessedMessages` | Webhook idempotency dedupe keys. | **Ephemeral / disposable** — loss risks only a rare double-process |
| `deliveryConfirmationEmailClaims` | Idempotency claim for confirmation emails. | **Ephemeral / disposable** — loss risks at most a duplicate email |

`_health` is **not a collection with data** — the readiness probe reads a
non-existent `_health/probe` document and never writes it (see TECHNICAL.md
"Health and readiness endpoints"), so it never appears in Firestore.

**Subcollections are included automatically** by Firestore managed exports and
managed backups of the whole database (they are part of each parent document's
document group). They are only excluded if you deliberately export a subset of
collection IDs — do not, for a disaster-recovery backup.

### Firebase Authentication

Firebase Auth users (Google / email-password identities, including **password
hashes**) are stored by Firebase Authentication, **not** in Firestore. **A
Firestore backup does NOT back up Auth users.** See §7.

### Firebase Storage

**Not in production use today.** Photo upload is a future phase: `storage.rules`
is deny-by-default and no application code reads or writes Storage (see
TECHNICAL.md "Firebase Storage"). There is therefore no production Storage data
to back up yet. See §8 for what to enable when property/proof photos ship.

### Data in Git (authoritative in the repository)

Firestore security rules (`firestore.rules`), Storage rules (`storage.rules`),
Firestore indexes (`firestore.indexes.json`), Vercel cron config
(`vercel.json`), Next.js config, and all application source are version
controlled — GitHub is authoritative for these (see §9).

### Data in vendor consoles (not in Git, not a Firestore export)

Environment variables / secrets (Firebase Admin service account, `RESEND_API_KEY`,
WhatsApp credentials, `CRON_SECRET`, `RATE_LIMIT_HASH_SECRET`, …) live in Vercel
and the respective vendor consoles. See §10.

### The continuity report is NOT a backup

The nightly Outstanding Delivery Snapshot PDF is an **operational outage aid**
(keep delivering during downtime — see `INCIDENT_RECOVERY.md`). It is a
point-in-time summary of *outstanding* requests, not a database backup, and must
**never** be treated as a recovery source of truth.

---

## 2. Recovery architecture: what Firebase/Google Cloud provides

Prefer **managed platform capabilities** over custom export scripts. Firestore
(in Native mode, which this project uses) offers three distinct managed
protections. They solve different problems — enable more than one.

| Capability | What it is | Best for | Restore target |
| --- | --- | --- | --- |
| **Point-in-time recovery (PITR)** | Continuous retention of prior versions for a rolling **7-day** window. Read or export the database as it was at a past minute (or any microsecond within the last hour). | Accidental writes/deletes and bad deployments **caught within 7 days**. Lowest data loss. | Export-at-timestamp → import into a database (see §11) |
| **Scheduled backups** (`gcloud firestore backups`) | Managed daily/weekly backups of the whole database with a configurable retention window. | A dependable recovery point independent of application behavior; longer retention than PITR. | `gcloud firestore databases restore` into a **new** database |
| **On-demand managed export** (`gcloud firestore export`) | A manual export of the database (or selected collections) to a private Cloud Storage bucket in Firestore's native format. | A safety net before a risky migration; long-term/offline retention; a copy you control. | `gcloud firestore import` |

**PITR vs. scheduled backups vs. exports — the difference that matters:**

- **PITR** protects against *recent* mistakes with near-zero data loss but only
  for 7 days and only while the project itself is healthy.
- **Scheduled backups** are managed recovery points you restore into a new
  database; they survive longer than the PITR window but each backup is only as
  fresh as its schedule (e.g. daily).
- **Exports** are operator-controlled copies (in a bucket you own) that protect
  against vendor/account-level problems and give you long-term retention, at the
  cost of being manual unless scheduled.

### Recommended protections (and why)

For this small government service:

1. **Enable PITR** (7-day window). It is the cheapest, highest-value protection
   against the most common incident — an accidental delete or a bad deployment
   noticed within a day or two. **[OPERATOR ACTION REQUIRED]**
2. **Enable a daily scheduled backup** with **14 days** retention (a reasonable
   floor; 28–35 days is stronger if the storage cost is acceptable). This is the
   dependable recovery point for anything beyond the PITR window. **[OPERATOR
   ACTION REQUIRED]**
3. **Take an on-demand export before any risky migration or bulk change**
   (e.g. before running a data-migration script). This is a manual habit, not a
   schedule.

Exact commands are in §11 (restore) and below (enable).

> **Cost note.** PITR and scheduled backups add storage cost proportional to
> database size and retention. This database is small (a single island's water
> deliveries), so the cost is expected to be minor, but it is **not zero** and
> **must be reviewed and approved** by the project owner before enabling. Do not
> enable billing-bearing features without that approval.

**Enable commands (run once, by an administrator):**

```bash
# Point-in-time recovery (7-day window) — [OPERATOR ACTION REQUIRED]
gcloud firestore databases update --database='(default)' --enable-pitr \
  --project=saba-water-delivery

# Daily scheduled backup, 14-day retention — [OPERATOR ACTION REQUIRED]
gcloud firestore backups schedules create --database='(default)' \
  --recurrence=daily --retention=14d --project=saba-water-delivery
```

Neither command is run by this repository. Verify the plan and cost in the
Google Cloud console first.

---

## 3. Recovery objectives (RPO / RTO)

These are **operational targets derived from the recommended protections**, not
vendor SLAs. Review them against the actual configuration before relying on
them.

| Objective | Target | Basis |
| --- | --- | --- |
| **RPO** (max data loss) | **≤ 24 hours** with daily scheduled backups; **~minutes** for any incident caught within the 7-day **PITR** window | Daily backup cadence; continuous PITR retention |
| **RTO** (time to restore) | **Hours, not minutes** — realistically a few hours for a full Firestore restore, validation, and service switch-over | Managed restore creates a new database; validation and reconciliation take operator time |

Do not promise stakeholders an RPO/RTO tighter than the enabled configuration
and a *tested* runbook can actually deliver. A single mis-set request is a
targeted repair (minutes), not a full restore (hours) — see §5.

---

## 4. Backup storage security and project separation

- Firestore managed backups and PITR are stored and encrypted by Google Cloud
  using platform defaults; you do not manage a bucket for them.
- **On-demand exports go to a Cloud Storage bucket you own.** That bucket
  **must** be private: **no public access**, least-privilege IAM (only the
  export/import service account and named administrators), a lifecycle rule to
  delete old exports per the retention policy, and platform default encryption
  at rest. Never make it public and never paste its full name into public
  channels unnecessarily; refer to it as `gs://<BACKUP_BUCKET>` in tickets.
- **Never** put a service-account key, password, or Auth export **in a script,
  in this repo, in a GitHub Actions artifact, or in logs.**

### Same project vs. separate project

| Level | What it protects against | Recommendation |
| --- | --- | --- |
| **Minimum viable** (backups/PITR in the **same** `saba-water-delivery` project) | Accidental deletes, bad deploys, corruption — the common cases | Acceptable baseline for launch |
| **Stronger** (periodic export copied to a bucket in a **separate** Google Cloud project/account) | Full project deletion, severe IAM compromise, account-level loss | Recommended follow-up; a same-project backup does **not** survive deletion of the project itself |

Do **not** create a second production project or account without explicit
authorization from the project owner. Document the decision either way.

---

## 5. Recovery modes — choose the smallest that fits

Do not use a full database restore for a small problem.

1. **Single-record / operator repair.** A stale driver lock, one bad request,
   one mis-set field. Use the application's own tools and the documented
   targeted scripts (e.g. `scripts/reconcile-stale-driver-locks.mjs` for stale
   `activeRequestId`), or dispatcher/admin actions. No restore.
2. **Partial data incident.** A single collection or a bounded set of documents
   damaged by a bad deploy/migration. Prefer **PITR export-at-timestamp of the
   affected data** restored into a **new** database for comparison, then a
   careful targeted correction — not a whole-database rollback.
3. **Full Firestore restore.** Widespread corruption or mass deletion. Restore a
   scheduled backup (or PITR export) into a **new** database, validate, then
   switch service. See §11.
4. **Full application recovery.** Project/account loss or a catastrophic
   deployment: recover code from GitHub (§9), recover config/secrets (§10),
   restore Firestore (§11) and Auth (§7), redeploy on Vercel, validate (§12).

---

## 6. Production recovery runbook

Use this for any incident that requires **data** recovery. Steps are mandatory
unless explicitly waived by the incident owner. Commands that **change or
overwrite data are labelled DESTRUCTIVE**.

### 6.1 Triage — decide whether a restore is even needed

- What is wrong: one record, one collection, or the whole database?
- When did it start? Identify the approximate timestamp **before** the damage.
- Is this actually data loss, or an *availability* outage? If the data is intact
  and only the site is down, this is an **outage** — see `INCIDENT_RECOVERY.md`,
  not a restore.
- If it is a single record or a stale lock, STOP — use a targeted repair (§5.1),
  not a restore.

### 6.2 Preserve current state (evidence)

- Do **not** delete the damaged data immediately — it is often the only record
  of what happened.
- Take an on-demand export of the **current** (damaged) database first so the
  damaged state is preserved for investigation:

  ```bash
  gcloud firestore export gs://<BACKUP_BUCKET>/incident-<YYYYMMDD-HHMM> \
    --project=saba-water-delivery
  ```

- Preserve relevant Vercel and Google Cloud audit logs.

### 6.3 Temporarily stop writes where appropriate

There is no built-in maintenance mode. To prevent further corruption during a
serious incident, an administrator can, as a deliberate and **DESTRUCTIVE-to-
availability** step:

- Pause the Vercel production deployment (Vercel dashboard) so the app cannot
  write, **or**
- Temporarily tighten `firestore.rules` to deny writes and deploy them
  (`firebase deploy --only firestore:rules`), then revert after recovery.

Communicate the freeze through the normal channel and keep deliveries moving
with the continuity report per `INCIDENT_RECOVERY.md`.

### 6.4 Select a restore point

- Within 7 days and want minimal loss → **PITR** at a chosen timestamp.
- Otherwise, or for a dependable daily point → a **scheduled backup**:

  ```bash
  gcloud firestore backups list --project=saba-water-delivery
  ```

### 6.5 Restore into a SEPARATE target first (never in place)

Restore to a **new database**, never over production, so you can validate before
switching:

```bash
# From a scheduled backup — creates a NEW database "recovery-<date>"
gcloud firestore databases restore \
  --source-backup=projects/saba-water-delivery/locations/<LOC>/backups/<BACKUP_ID> \
  --destination-database=recovery-<YYYYMMDD> \
  --project=saba-water-delivery
```

```bash
# OR from PITR: export as of a timestamp, then import into a new/empty database.
gcloud firestore export gs://<BACKUP_BUCKET>/pitr-<YYYYMMDD-HHMM> \
  --snapshot-time=<RFC3339_TIMESTAMP> --project=saba-water-delivery
# then, into a new database you created for recovery:  [DESTRUCTIVE to target db]
gcloud firestore import gs://<BACKUP_BUCKET>/pitr-<YYYYMMDD-HHMM> \
  --database=recovery-<YYYYMMDD> --project=saba-water-delivery
```

### 6.6 Validate the restored data (§12)

Run the post-restore validation checklist and the read-only validator against
the **recovery** database before considering a switch.

### 6.7 Recover Auth if needed (§7) and Storage if used (§8)

### 6.8 Switch service to the recovered data

Only after validation passes and the incident owner approves. Point the app at
the recovered database (update the relevant Vercel environment variable /
Firebase database selection) or promote the recovered database per your Firebase
setup. Keep the damaged database until the incident is fully resolved and
audited.

### 6.9 Rotate credentials if compromise is suspected (§10)

### 6.10 Verify application health

- `curl -i https://<deployment>/api/health` → 200, `/api/readiness` → `ready`.
- Sign-in works; resident, dispatcher, and driver portals load; a PDF generates.

### 6.11 Document the incident

Record the root cause, the chosen restore point, validation results,
reconciliation gaps (records created between the restore point and the incident),
and lessons learned. Update this runbook if any step was unclear.

### Explicit warnings

- Do **not** `gcloud firestore import` over the **production** database during an
  incident without first preserving the current state (§6.2) and getting sign-off
  — **import overwrites documents with matching paths** and does not delete
  others, which can produce a confusing half-restored state.
- Do **not** run data-migration scripts (`scripts/migrate-*`) against production
  during recovery without a fresh export first.
- Do **not** treat the continuity-report PDF as a data source of truth.

---

## 7. Firebase Authentication recovery

**Firestore backups do not include Auth users.** Auth identities are recovered
separately with the Firebase CLI.

- **Export** (manual, run by an administrator on a trusted machine):

  ```bash
  # Produces password hashes + salts + provider identities — HANDLE AS A SECRET.
  firebase auth:export auth-users.json --format=json --project=saba-water-delivery
  ```

- **Import** (DESTRUCTIVE — recreates users; match the original hash parameters):

  ```bash
  firebase auth:import auth-users.json --hash-algo=SCRYPT \
    --hash-key=<...> --salt-separator=<...> --rounds=<...> --mem-cost=<...> \
    --project=<TARGET_PROJECT>
  ```

  The hash parameters are shown in the Firebase console (Authentication → Users →
  ⋮ → "Password hash parameters") and are required for imported password users to
  be able to sign in.

**Handling rules (mandatory):**

- **Never** commit an Auth export, upload it to a GitHub Actions artifact, put it
  in this repo, or log its contents. It contains password hashes and PII.
- Store it only on an administrator's trusted machine or encrypted admin storage,
  and delete it when the recovery/drill is complete.

**Automated Auth backup decision.** For a system of this scale, an *automated,
stored* Auth export is **not recommended** — a scheduled job that writes password
hashes to storage is a standing liability that outweighs the benefit here.
Instead: (a) most users are Google-sign-in, whose identity is recoverable via
Google regardless; (b) take a **manual** Auth export before any risky Auth change
and before a project migration; (c) accept the documented limitation below. If
the government later requires automated Auth backup, design it to write to a
dedicated, access-restricted, encrypted bucket — never to CI artifacts.

**Limitation.** Without automated Auth backup, an accidental mass Auth deletion
between manual exports could lose email/password users' credentials (Google
users can re-authenticate via Google). This is an accepted trade-off for this
scale; document it for the project owner.

**Keep identity aligned after restore.** Restored Auth users and Firestore
`users/{uid}` records must stay aligned by `uid`. If you restore Firestore and
Auth from different points in time, verify that request/driver ownership still
resolves (the validator in §12 flags `users/{uid}` documents missing for
existing requests), and preserve account-merge semantics
(`accountMergeEvents` + the canonical/duplicate `uid` mapping) — do not
re-introduce a merged-away duplicate `uid`.

---

## 8. Firebase Storage recovery

Storage is **not used in production yet** (see §1). There is nothing to back up
today. When property/proof-of-delivery photos are implemented:

- Enable **Object Versioning** on the Storage/GCS bucket so overwritten or
  deleted objects can be recovered:

  ```bash
  gcloud storage buckets update gs://<STORAGE_BUCKET> --versioning
  ```

- Consider a lifecycle rule to expire noncurrent versions after a retention
  period, and document restore-from-noncurrent-version steps.
- Do **not** copy Storage objects into the repository or GitHub.
- Photo *metadata* lives in Firestore (`users/{uid}/propertyPhotos`,
  `waterRequests/{id}/photos`) and is covered by the Firestore backup; the
  binary objects are covered by Storage versioning. A restore must consider both.

Until photos ship, record in this document that Storage carries no
production-critical data.

---

## 9. Source-code recovery

**GitHub is authoritative** for all application code and the configuration files
committed to the repository:

- Protected `main` branch (branch protection / required checks — see
  [`DEPLOYMENT.md`](./DEPLOYMENT.md)).
- Full Git history.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `vercel.json`,
  `next.config.ts`, and all source are in Git.

To recover from repository loss or a bad `main`: clone from GitHub (or restore
the repository from GitHub's own protections), check out the last known-good
commit, and redeploy via Vercel's Git integration.

**Release tagging (recommendation, not enabled by this PR).** The project does
not currently tag releases. Adding a lightweight tag per production release
(e.g. `git tag -a v2026.09.12 -m "…"`) would make "deploy known-good code"
unambiguous during recovery. This is a recommended follow-up, kept out of scope
here to avoid broadening this issue.

---

## 10. Environment / secrets recovery

Production configuration is **not in Git** and is **not** part of any Firestore
backup. Do not export or commit values. This is a **names-only** inventory of
what must exist for the app to run, and where the authoritative copy lives.

| Variable (name only) | Authoritative source | On loss |
| --- | --- | --- |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase console → Project settings → Service accounts | **Re-create** a service-account key in the console (the private key cannot be re-downloaded); update Vercel |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase console → Project settings → Your apps | Re-copy from console (not secret) |
| `RESEND_API_KEY` | Resend dashboard → API Keys | **Rotate** (create new key); update Vercel |
| `CONTINUITY_REPORT_EMAIL_FROM` / `_TO`, `DELIVERY_CONFIRMATION_EMAIL_FROM` | Operational decision (recorded in `.env.example` docs) | Re-enter values |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta App Dashboard → WhatsApp | **Rotate/recover** in Meta; re-set the webhook verify token |
| `CRON_SECRET` | Chosen value stored only in Vercel | **Re-generate** and set in Vercel (Vercel Cron uses it) |
| `RATE_LIMIT_HASH_SECRET` | Chosen value stored only in Vercel (Production and Preview) | **Re-generate** and set; rotating it harmlessly resets in-flight rate-limit windows |
| `LOG_LEVEL`, `CSP_REPORT_ONLY` | Optional; defaults documented in `.env.example` | Re-enter if used |

- **Authoritative copies live in Vercel** (project → Settings → Environment
  Variables) and in each vendor console. The exact set of required names is in
  [`.env.example`](../.env.example) and [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- Do **not** build a secrets-backup file. Prefer vendor/admin-console recovery
  and rotation. Variables whose loss requires **recreation** (Firebase service
  account private key) or **rotation** (Resend, WhatsApp, `CRON_SECRET`,
  `RATE_LIMIT_HASH_SECRET`) are marked above.

---

## 11. Post-restore validation

A restore is not successful merely because Firestore accepted the import. Before
switching service to a recovered database, validate it.

### Read-only recovery validator

`scripts/verify-recovery.mjs` (logic in `scripts/lib/recovery-checks.mjs`,
tested in `scripts/lib/__tests__/recovery-checks.test.ts`) inspects a Firestore
database and reports cross-document inconsistencies. It is **read-only** — it
never mutates and prints only opaque document IDs and categorical reasons (no
names, emails, or phones). It exits non-zero when it finds anything, so a drill
can gate on it.

Checks (the important cross-document invariants after a restore):

- **Stale driver locks** — a `driverRegistry.activeRequestId` pointing to a
  request that is missing, reassigned, or no longer `claimed` (mirrors the
  runtime self-healing rule in `activeRequestValidation.ts`).
- **Claimed request / driver mismatch** — a `claimed` request with no
  `assignedDriverId`, an `assignedDriverId` with no (non-archived) driver
  registry entry, or a driver whose `activeRequestId` does not point back.
- **Delivery-run membership** — a `dispatchBatches.originalRequestIds` entry
  referencing a missing request, or a request whose `dispatchBatchId` points at
  a missing batch.
- **Orphaned ownership** — a registered request (`customerId` set) whose
  `users/{uid}` document is missing.

Run it against the recovery database or an emulator drill (see §13), never as a
"fix" — remediation uses the targeted tools in §5:

```bash
# Against a restored/isolated project (read-only service-account credentials):
FIREBASE_SERVICE_ACCOUNT_KEY='<service-account-json>' node scripts/verify-recovery.mjs
# or: npm run verify:recovery   (with the same env provided)
```

### Manual validation checklist

- Representative **users** exist with expected roles (spot-check a resident, a
  driver, a dispatcher).
- Representative **requests** exist with correct status, quantity, village, and
  customer snapshot.
- **Audit history** (`waterRequests/{id}/events`, `driverRegistry/{id}/events`,
  role events, `accountMergeEvents`) is present and continuous, or gaps are
  documented.
- **Driver registry** eligibility/availability and `activeRequestId` locks are
  consistent (validator above).
- **Delivery Runs** list their member requests correctly.
- **Config** (`config/dispatchSettings`) matches expected operational values.
- The validator reports **zero** findings, or every finding is understood and
  has a targeted-repair plan.
- Do **not** print or paste personal data (names, emails, phones) into tickets
  or logs during validation.

---

## 12. Restore drills — a backup you have never restored is not trusted

Test recovery on a cadence (a **quarterly** drill is reasonable for this
service). **Never test a restore against live production data in place.** Prefer,
in order: the emulator, an isolated/test project, another non-production
environment.

### Local emulator validation drill (no cloud cost)

This proves the post-restore validation tooling works end to end without
touching production or incurring cloud cost:

```bash
# Start the Firestore emulator, seed a small synthetic dataset (or import a
# sanitized export), then run the read-only validator against it.
firebase emulators:exec --only firestore "node scripts/verify-recovery.mjs"
```

An empty emulator reports zero findings and exits 0; seed a deliberately
inconsistent document (e.g. a driver with a stale `activeRequestId`) to see the
validator flag it. The validator's checks are also covered by unit tests
(`npm run test`).

### Managed-restore drill (isolated/test project — [OPERATOR ACTION REQUIRED])

Once per quarter, an administrator should prove a real managed backup restores:

1. Restore the latest scheduled backup into a **new** database (or a dedicated
   test project) — never over production (§6.5).
2. Run the validation checklist and `verify-recovery.mjs` against it.
3. Record the restore time (informing the RTO target) and any findings.
4. Delete the drill database/project afterward to avoid recurring cost.

Document any recurring cloud cost a drill incurs before scheduling it.

---

## 13. Backup monitoring

- **Verify backups are actually happening** in the Google Cloud console:
  Firestore → Backups shows scheduled-backup history and PITR status
  (`gcloud firestore backups list` and `gcloud firestore databases describe`).
- If a simple supported alert for backup failures is available in the project's
  Cloud Monitoring, enable it. Do **not** build a custom backup-monitoring
  service inside this application.
- Confirm during each quarterly drill that recent backups exist and are
  restorable.

---

## 14. Summary of manual actions this document requires

Nothing in this PR enables a cloud backup. A project administrator must:

- **[OPERATOR ACTION REQUIRED]** Enable Firestore PITR (§2).
- **[OPERATOR ACTION REQUIRED]** Create a daily scheduled backup with retention
  (§2), after reviewing cost.
- **[OPERATOR ACTION REQUIRED]** Create/secure a private export bucket with
  least-privilege IAM and a lifecycle rule if on-demand exports are used (§4).
- **[OPERATOR ACTION REQUIRED]** Decide same-project vs. separate-project backup
  storage (§4) and document it.
- **[OPERATOR ACTION REQUIRED]** Establish the manual Auth-export habit and
  storage/handling rules (§7).
- **[OPERATOR ACTION REQUIRED]** Enable Storage object versioning **when** photos
  ship (§8).
- **Ongoing:** run the quarterly restore drill (§12) and verify backups (§13).
