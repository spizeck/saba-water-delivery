# Disaster Recovery

[Home](Home.md) · Exact procedures: [DISASTER_RECOVERY.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/DISASTER_RECOVERY.md)

An operational incident concerns keeping deliveries moving while the service or a dependency is unavailable. Disaster recovery concerns restoring lost, deleted, corrupted, or inaccessible data and the systems needed to use it. An outage alone does not mean the database needs restoring. Start with [INCIDENT_RECOVERY.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/INCIDENT_RECOVERY.md); involve technical support if data damage is suspected.

## Recovery principles

The repository's Firestore strategy combines managed point-in-time recovery for recent mistakes, scheduled backups for retained recovery points, and on-demand managed exports for operator-controlled copies. These protections require operator activation and verification. Their presence in the runbook does not mean they are enabled; [#60](https://github.com/spizeck/saba-water-delivery/issues/60) tracks production enablement and proof.

The recovery owner should establish the scope and time of damage, preserve evidence, and choose the smallest suitable intervention. A single incorrect record may need targeted repair rather than a database rollback. Technical staff must control writes through the runbook when necessary: client Firestore rules alone do not freeze trusted server writes.

**Restore into a separate target first.** Validate the restored data and application behavior before an authorized switch of service. Preserve the damaged state for investigation and account for deliveries or requests made after the chosen recovery point. The read-only recovery validator helps find inconsistencies; it does not repair them automatically or replace the full validation checklist.

## Separate recovery responsibilities

- **Firestore:** request records, profiles, roles, Registry, runs, and durable history need data recovery.
- **Firebase Authentication:** identities are separate from Firestore backups. Restore planning must align account identities with their records; Auth exports contain sensitive material and belong in protected recovery storage.
- **Source and configuration:** GitHub source and vendor-held configuration/credentials must remain recoverable independently of database backups.
- **Firebase Storage:** photo uploads are not in current production use according to the repository. Future photo data requires its own protection; do not claim it is covered today.

Protection is **per Firestore database**. A named recovery database does not inherit the default database's PITR or scheduled backups. If production remains on that named database, its protection must be verified, or the failover must be explicitly temporary with the backup-risk window documented until consolidation. All evidence and monitoring must refer to the database actually serving production.

The continuity PDF lists outstanding work so dispatch can keep coordinating. It omits the full database and Auth identities and is **not a backup**. Recovery timing/data-loss targets depend on protections actually enabled and a tested drill; this Wiki promises neither a recovery time nor zero data loss.

Government recovery ownership and the final acceptance exercise are explained in [Production Handover](Production-Handover.md). Use the canonical runbook for commands, authorization checkpoints, recovery-target selection, and validation.
