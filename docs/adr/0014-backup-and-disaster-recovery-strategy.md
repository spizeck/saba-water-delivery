# 0014. Backup and disaster-recovery strategy

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (strategy established 2026-09-12 via #35;
  records that decision)

## Context

A government service needs a tested way to recover its data after accidental
deletion, a bad deployment, a botched migration, or a project/account problem —
operable by a future maintainer, and without a fragile custom backup system.

## Decision (architectural policy)

- **Use managed Firebase/Google Cloud protections, not a custom JSON backup
  system.** Firestore offers three complementary managed protections, meant to be
  used together: **point-in-time recovery (PITR)** (rolling 7-day window),
  **scheduled backups** (managed daily/retained recovery points), and **on-demand
  managed exports** (operator-controlled copies for long-term/offline retention).
- **Restore into a separate target first**, validate, then switch — never restore
  over production in place. The app can serve a named recovery database via
  `FIREBASE_DATABASE_ID` (default `(default)`), or the validated data can be
  consolidated back into `(default)` by export/import.
- **Read-only validation before promotion.** A validator
  (`scripts/verify-recovery.mjs`) checks cross-document consistency (stale driver
  locks, claimed/driver mismatches — batch-aware per
  [0008](./0008-delivery-runs-batch-dispatch-exception.md), delivery-run
  membership, orphaned ownership) read-only, printing only opaque ids, before any
  switch. It is **not** an auto-fix.
- **Firebase Auth is handled separately** — a Firestore backup does not include
  Auth users; they are exported/imported via the Firebase CLI, and Auth exports
  (password hashes + PII) are never committed, logged, or put in CI artifacts.
- **The continuity report is an outage aid, not a backup**
  ([0011](./0011-external-integration-failure-model.md)).
- **No automatic destructive restore** and no custom database replication.

## Distinguishing policy from activation

**This is architectural policy; it does not by itself enable any cloud backup.**
Enabling PITR, creating a scheduled-backup schedule, provisioning a private
export bucket, and enabling Storage versioning are **operator/console actions**
that a project administrator must perform (and whose cost they must approve). The
repository contains no evidence that these are enabled, and this ADR does not
claim they are. See [`../DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) for the
exact commands, each marked **[OPERATOR ACTION REQUIRED]**.

## Alternatives considered

- **A custom script exporting every document to JSON:** rejected — managed PITR
  + backups are more reliable, cheaper to operate, and avoid a bespoke system to
  maintain and secure.
- **PITR only, or backups only:** rejected — they protect different windows;
  enable both plus occasional exports.
- **Automatic in-place production restore:** rejected — too dangerous; recovery
  is validated into a separate target first.

## Consequences / operational implications

- **Dangerous assumptions to preserve:** (1) **backup/PITR protection is per
  database** — the settings on `(default)` do NOT protect another named database.
  (2) **A named recovery database does not inherit `(default)`'s protections**;
  before leaving production on a named database, either enable PITR/scheduled
  backups on it or treat the failover as temporary with a documented backup-risk
  window until consolidation. (3) Recovery/evidence/monitoring commands must
  target the currently served database (an `ACTIVE_DATABASE` convention), not
  assume `(default)`.
- RPO target: ≤ 24h with daily backups, ~minutes within the PITR window; RTO:
  hours. These depend on the operator actually enabling the protections.

## References

- [`../DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) (full runbook, RPO/RTO,
  operator-action list)
- [`scripts/verify-recovery.mjs`](../../scripts/verify-recovery.mjs),
  [`scripts/lib/recovery-checks.mjs`](../../scripts/lib/recovery-checks.mjs),
  [`scripts/lib/recovery-target.mjs`](../../scripts/lib/recovery-target.mjs)
- [`src/lib/firebase/admin.ts`](../../src/lib/firebase/admin.ts)
  (`FIREBASE_DATABASE_ID`)
