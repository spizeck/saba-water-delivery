# 0010. Business audit events vs. application logs

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (durable business audit events present from
  2026-08-18; structured application logging added 2026-09-11 via #29; records an
  existing decision). Updated 2026-09-13 (#49) to record the stronger
  required-audit-event atomicity guarantee now implemented.

## Context

The system needs two different kinds of history that are easy to confuse: a
durable, authoritative record of _what happened to the business data_ (who
claimed, delivered, reassigned, changed a role, merged an account), and
_operational telemetry_ for debugging a running deployment. Mixing them risks
either losing authoritative history in ephemeral logs or leaking personal data
into logs.

## Decision

- **Durable business audit events live in Firestore**, as event subcollections
  next to the records they describe (e.g. `waterRequests/{id}/events`,
  `driverRegistry/{id}/events`, `users/{uid}/roleEvents`,
  `config/dispatchSettings/events`) plus root audit collections such as
  `accountMergeEvents`. These are the **source of truth for business history**
  and are covered by the database backup ([0014](./0014-backup-and-disaster-recovery-strategy.md)).
- **Structured application logs are operational telemetry only** — one JSON line
  per entry to stdout/stderr (captured by Vercel), with a stable event name and a
  correlated request id. They are **not** the source of truth for business
  history and may be lost or rotated without data loss.
- Distinct event types are used where an action could otherwise be
  misattributed — e.g. a staff-recorded delivery
  (`marked_delivered_by_dispatcher` / `_batch`) is never conflated with a
  driver's own `marked_delivered`.
- **Required audit events are atomic with their state change.** Audit events
  are classified as either **required** (the durable, authoritative record of a
  sensitive administrative/dispatcher mutation — accountability depends on it)
  or **operational/best-effort** (high-frequency, transient, or self-service
  telemetry whose loss is not an accountability gap). Every _required_ audit
  event is written **in the same Firestore transaction** as the business-state
  mutation it records, so the state change and its required event commit
  together or not at all (issue #49). See Operational implications for the
  precise boundary — including the one external-system exception (account merge
  / Firebase Auth deletion) — and for which events are classified operational.
- **No unnecessary personal data is logged.** Application logs pass through a
  redaction layer and deliberately exclude names, emails, phones, tokens, request
  notes, and message bodies (see [0012](./0012-security-and-observability-baseline.md)).

## Alternatives considered

- **Logs as the audit trail:** rejected — logs are ephemeral and not
  transactional; business accountability needs durable, queryable records.
- **A separate audit database/service:** rejected — Firestore subcollections
  co-located with the record are simpler and backed up together. Co-location
  alone does not _guarantee_ atomicity, so it is enforced explicitly: every
  required audit event is written in the same Firestore transaction as its
  business-state change (issue #49; see Operational implications for the
  boundary and the single external-system exception). Firestore transactions
  give this all-or-nothing guarantee wherever every participating write is a
  Firestore write.

## Consequences

- Business history survives as long as the data does and is restored with it.
- Investigating a live incident uses logs + request ids for correlation, but the
  authoritative "what happened" is the Firestore audit trail.
- Preserving audit data during an incident matters: do not delete role/request/
  registry events as "cleanup" (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)).

## Operational implications

- When adding a new significant action, record a durable audit event, not just a
  log line — and write the event **in the same transaction** as the business
  change so the record cannot be lost if the second write fails.
- **Required audit-event atomicity (issue #49, implemented).** Every sensitive
  administrative/dispatcher Firestore mutation whose durable event is _required_
  for accountability now writes that event in the **same Firestore transaction**
  as the state change, so the change cannot commit without its audit history.
  This covers: role grant/removal (`removeRole` also serializes the last-admin
  invariant — ADR 0005 / #48 / #70); driver-registry create/update/link/unlink/
  restrict/reinstate/archive/restore and meter-assignment add/update/remove;
  dispatch-settings updates (`dispatch_settings_updated`, whose `oldValues` are
  now read _inside_ the transaction so concurrent updates cannot record a stale
  before-image); every `waterRequests` transition (create, claim, edit, priority
  change, escalate, assign/reassign/return-to-queue, deliver, confirm, dispute,
  resolve, cancel, auto-confirm, collection); batch creation and manual close
  (`dispatch_batch_closed`); staff-created person registration
  (`person_registered`); and account merge (below).
- **Account merge — the one external-system boundary.** `mergeUserAccounts`
  commits **all of its Firestore effects in a single transaction** — canonical
  role change, duplicate `admin` revocation, last-admin invariant participation,
  driver-registry relink, request-ownership relinks, and the authoritative
  `accountMergeEvents` record — so no merge state commits without its audit
  record. The request-relink count is capped so the whole transaction stays
  within Firestore's 500-write limit; an oversized merge fails closed before any
  write. The **only** merge side effect that cannot join the transaction is
  deleting the duplicate's **Firebase Authentication** identity — Firebase Auth
  is not a Firestore transaction participant. It runs after the commit (so a
  transaction failure never deletes an Auth account for a merge that did not
  happen), and its outcome (`duplicateAuthDeleted` / `error`) is written back to
  the already-durable audit record by a best-effort update. A crash between the
  Firestore commit and that update leaves a fully consistent, fully audited
  merge whose only residue is a leftover (login-disabled) duplicate Auth account
  and an audit record that still reads `duplicateAuthDeleted: false`; staff can
  delete such an account manually. A durable/resumable reconciliation of that
  external step is deliberately **out of scope for #49** and is a candidate
  follow-up; #49 does not overstate it as atomic.
- **Best-effort / operational events are intentionally NOT transactional.**
  Some events are operational telemetry, not required accountability history,
  and are deliberately left as best-effort appends: driver availability toggles
  (`driver_online` / `driver_offline`), decline cooldown starts recorded outside
  the atomic decline path, and batch run-sheet reprints
  (`dispatch_batch_reprinted`). For these the state field itself (e.g.
  `availabilityStatus`, `generatedAt`) carries the current value, and losing the
  event is not an accountability gap. The point of #49 was to define the
  required-audit boundary correctly — not to force every event into a
  transaction.
- Log volume is deliberately quiet for routine success (e.g. health probes log at
  debug) so meaningful events stand out ([0012](./0012-security-and-observability-baseline.md)).

## References

- [`src/lib/logging/`](../../src/lib/logging) (logger, redaction, serializeError,
  request context, security events)
- Event types in [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts)
  (`WaterRequestEventType`, `DriverEventType`, `DispatchBatchEventType`,
  `AccountMergeEvent`)
- TECHNICAL.md "Auditability", "Operational logging and observability"
