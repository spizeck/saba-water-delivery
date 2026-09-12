# 0010. Business audit events vs. application logs

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (durable business audit events present from
  2026-08-18; structured application logging added 2026-09-11 via #29; records an
  existing decision)

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
- **No unnecessary personal data is logged.** Application logs pass through a
  redaction layer and deliberately exclude names, emails, phones, tokens, request
  notes, and message bodies (see [0012](./0012-security-and-observability-baseline.md)).

## Alternatives considered

- **Logs as the audit trail:** rejected — logs are ephemeral and not
  transactional; business accountability needs durable, queryable records.
- **A separate audit database/service:** rejected — Firestore subcollections
  co-located with the record are simpler and backed up together. Atomicity with
  the business change depends on the mutation path and is **not** guaranteed by
  co-location alone: some paths write the change and its event in one Firestore
  transaction (e.g. driver-registry restrict/reinstate/link), while others commit
  the change and then append the event in a separate write (e.g. dispatch-settings
  updates). See Operational implications.

## Consequences

- Business history survives as long as the data does and is restored with it.
- Investigating a live incident uses logs + request ids for correlation, but the
  authoritative "what happened" is the Firestore audit trail.
- Preserving audit data during an incident matters: do not delete role/request/
  registry events as "cleanup" (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)).

## Operational implications

- When adding a new significant action, record a durable audit event, not just a
  log line — and prefer writing the event **in the same transaction** as the
  business change so the record cannot be lost if the second write fails.
- **Known limitation / follow-up (issue #49):** not every existing path is
  transactional (e.g. dispatch-settings updates append the event after committing
  the change), so a rare failure between the two writes could leave a change
  without its audit event. Making required audit events atomic with sensitive
  admin mutations is tracked in
  [#49](https://github.com/spizeck/saba-water-delivery/issues/49); this ADR
  documents the current behavior rather than overstating it.
- Log volume is deliberately quiet for routine success (e.g. health probes log at
  debug) so meaningful events stand out ([0012](./0012-security-and-observability-baseline.md)).

## References

- [`src/lib/logging/`](../../src/lib/logging) (logger, redaction, serializeError,
  request context, security events)
- Event types in [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts)
  (`WaterRequestEventType`, `DriverEventType`, `DispatchBatchEventType`,
  `AccountMergeEvent`)
- TECHNICAL.md "Auditability", "Operational logging and observability"
