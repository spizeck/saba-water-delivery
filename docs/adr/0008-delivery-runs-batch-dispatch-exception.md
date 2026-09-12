# 0008. Delivery Runs as a controlled exception to single-request dispatch

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-24, "Batch
  Dispatch"; renamed to "Delivery Runs" 2026-08-27; records an existing decision)

## Context

The normal dispatch model gives a driver exactly one active claimed request at a
time, tracked by the `driverRegistry.activeRequestId` lock
([0007](./0007-dispatch-fairness-and-preferred-driver-policy.md)). But real
operations sometimes need a dispatcher to preassign **several loads to one
driver at once** — for example, a driver whose phone/data is unreliable who is
handed a single printed run sheet for the day. Forcing that through the
one-at-a-time model would not work.

## Decision

Introduce **Delivery Runs** (`dispatchBatches`): a deliberate,
dispatcher-controlled **exception** to the one-active-request rule. A Delivery
Run assigns multiple requests to one driver together and produces a printable run
sheet. Each member request is set to `claimed` and carries `dispatchBatchId`
linking it to the run.

**Crucially, `driverRegistry.activeRequestId` does NOT represent every request in
a run.** A driver on a Delivery Run legitimately holds multiple `claimed`
requests, most of which are not the single `activeRequestId`. Batch membership is
determined by each request's `dispatchBatchId` pointing at the run — the live
membership — while the run's `originalRequestIds` is an immutable record of the
original assignment.

## Alternatives considered

- **No batch capability (one-at-a-time only):** rejected — cannot support a
  driver who must take a day's loads on paper without live app interaction.
- **Reusing `activeRequestId` for all run members:** impossible — the lock holds
  one request id; a run has many. This is exactly why the exception is documented.
- **A parallel request system for batches:** rejected — runs use the same
  `waterRequests` documents and the same delivered → confirmed lifecycle; there
  is no separate queue.

## Consequences

- Consistency checks and any future validators must treat batch loads specially:
  a `claimed` request whose driver's `activeRequestId` is null or points
  elsewhere is **normal** when the request has a `dispatchBatchId`. The
  disaster-recovery validator encodes exactly this
  ([0014](./0014-backup-and-disaster-recovery-strategy.md);
  `scripts/lib/recovery-checks.mjs` skips the back-pointer check for batch loads).
- Batch status (`active`/`completed`) is a maintained cache derived from members'
  statuses; reassigning or cancelling a member updates membership without
  rewriting the immutable `originalRequestIds`.
- Staff can record delivery for a batch load the driver could not mark
  themselves ("paper reconciliation"), with a distinct audit event
  ([0009](./0009-delivery-completion-and-resident-confirmation.md),
  [0010](./0010-audit-events-vs-application-logs.md)).

## Operational implications

- **Dangerous assumption to preserve:** do not "fix" the fact that a run's driver
  has multiple `claimed` requests not equal to `activeRequestId`. That is by
  design; treating it as corruption would break Delivery Runs.
- A delivered/awaiting-confirmation member must not block the run's remaining
  physical work ([0009](./0009-delivery-completion-and-resident-confirmation.md)).

## References

- [`src/lib/domain/dispatchBatches.ts`](../../src/lib/domain/dispatchBatches.ts),
  [`src/lib/domain/dispatchBatchSelection.ts`](../../src/lib/domain/dispatchBatchSelection.ts)
- [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts) (`DispatchBatch`,
  `dispatchBatchId`, `originalRequestIds`)
- [`scripts/lib/recovery-checks.mjs`](../../scripts/lib/recovery-checks.mjs)
  (batch-aware consistency check)
- TECHNICAL.md "Batch Dispatch"; [`../DISPATCHER_GUIDE.md`](../DISPATCHER_GUIDE.md)
