# 0009. Delivery completion and resident confirmation model

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18 onward;
  records an existing decision)

## Context

Two different questions must not be conflated: (1) has the driver physically
finished this delivery and become free for other work, and (2) has the resident
confirmed they received the water (an accountability record). Blocking a driver's
next job on the resident's confirmation would stall operations.

## Decision

- A driver (or staff on their behalf) **marks a request `delivered`** once the
  full requested quantity is delivered. At `delivered`, **the driver is
  operationally released** — they no longer physically owe work for this request
  and can take the next one. The `activeRequestId` lock is freed at `delivered`,
  not at confirmation.
- Resident **confirmation/dispute is a separate, later lifecycle state**:
  `delivered` → `confirmed` (resident says received) or `disputed` (resident
  reports a problem). This is accountability, not physical work.
- **A `delivered`-awaiting-confirmation request is NOT active physical driver
  work** and must not block new physical work (for the driver or, in a Delivery
  Run, for the rest of the run — see [0008](./0008-delivery-runs-batch-dispatch-exception.md)).
- **Lazy auto-confirmation:** if the resident does not respond within the
  configured window (24 hours), the request auto-confirms on the next read that
  evaluates it — there is no scheduled job; the deadline is computed and enforced
  lazily. This prevents requests sitting open forever.
- The **delivery-confirmation email is best-effort** and must never roll back or
  block the recorded delivery ([0011](./0011-external-integration-failure-model.md)).
- Every transition records a durable audit event, and a **staff-recorded**
  delivery uses a distinct event type so it is never misrepresented as the
  driver's own action ([0010](./0010-audit-events-vs-application-logs.md)).

## Alternatives considered

- **Keeping the driver "busy" until the resident confirms:** rejected — it would
  stall drivers on residents who never respond.
- **A separate "delivered-but-unconfirmed" status:** rejected — the distinction
  is computed from `status === "delivered"` plus the confirmation deadline; a
  separate persisted status is unnecessary and would add drift.
- **A scheduled cron to auto-confirm:** rejected in favor of lazy evaluation — no
  extra infrastructure, and correctness does not depend on a job firing on time.

## Consequences

- `activeRequestId` clears at `delivered`; the physically-active definition is
  precisely `status === "claimed"` (`isPhysicallyActiveDriverWork`).
- Auto-confirm depends on documents being read; a never-viewed delivered request
  is confirmed the next time its state is evaluated, using the deadline math.
- A **registered** resident can confirm or dispute their own delivery
  (`disputeWaterDelivery` requires the request's `customerId` to match, so it is
  a resident-only action). For an **unregistered** customer (no `customerId`),
  staff can record **confirmation** on their behalf, but there is **no
  staff-created dispute transition** — staff can only resolve a dispute that a
  registered resident has already raised (`resolveDisputeCompleted` /
  `resolveDisputeReopened`). An unregistered customer's complaint is therefore
  handled operationally (e.g. by reopening/creating a request), not as a
  `disputed` state.

## Operational implications

- **Dangerous assumption to preserve:** do not treat a `delivered`
  (awaiting-confirmation) request as blocking the driver's or the run's next
  work. Physically-active work is `claimed` only.
- Reconciling manually-handled deliveries after an outage uses the same
  mark-delivered paths (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)
  "Recovery").

## References

- [`src/lib/domain/deliveryConfirmation.ts`](../../src/lib/domain/deliveryConfirmation.ts)
  (`deliveryConfirmationWindowHours`, lazy deadline),
  [`src/lib/domain/activeRequestValidation.ts`](../../src/lib/domain/activeRequestValidation.ts)
  (`isPhysicallyActiveDriverWork`)
- [`src/app/driver/actions.ts`](../../src/app/driver/actions.ts),
  [`src/app/resident/actions.ts`](../../src/app/resident/actions.ts)
- TECHNICAL.md "Delivery Confirmation Timeout"
