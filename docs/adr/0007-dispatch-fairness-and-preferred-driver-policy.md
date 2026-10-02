# 0007. Dispatch fairness and preferred-driver policy

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18/19;
  records an existing decision)

## Context

This is a public-service water operation. Dispatch must be **fair** across
drivers and prioritized by genuine need, while still honoring a resident's
preferred driver where that does not compromise fairness or timeliness. The
policy encoded here is operational/public-service policy, not merely a technical
convenience.

## Decision

> **Implementation note updated for #66:** the ordering below is the canonical
> comparator AND the effective retrieval order. `dispatch.ts` pages the
> complete eligible queue in canonical order via per-bucket ranked/by-age
> streams plus a missing-field catch-all (see
> [TECHNICAL.md](../../TECHNICAL.md#dispatch-assignment-selection)); an earlier
> implementation fetched only `limit(100)` age-ordered candidates before
> sorting, which could hide an escalated request behind the window.
>
> **Superseded for #123:** the "Offers, not a browsable list" mechanism below
> described a pending-offer + explicit-accept workflow. Since
> [0021](./0021-assignment-on-visibility-dispatch.md) the driver portal uses
> assignment-on-visibility: the claim transaction runs before details are
> shown, and "decline" is now an explicit release of an assigned delivery.
> The fairness policy (ordering, one-at-a-time, decline cooldown) is
> unchanged — only the acceptance mechanism was replaced.

- **Priority ordering.** The dispatch queue comparator
  (`dispatchQueueCompare`) sorts by three keys, in this order:
  1. **Priority bucket:** `critical` > `urgent` > `normal`. The bucket is
     compared **first**, before override rank and age.
  2. **Dispatcher override rank** (`dispatchOverrideRank`): within the same
     bucket, a ranked request sorts ahead of higher-ranked and unranked ones
     (lower rank first; unranked is treated as last).
  3. **Original request time** (`requestedAt`): remaining ties and unranked
     requests are ordered oldest-first — fairness-by-age.

  There are **two** authorized, audited staff overrides that can move a newer
  request ahead of an older one, and they act on different keys:
  - a **priority override** (`changeRequestPriority`) moves a request into a
    different **bucket** (e.g. `normal` → `urgent`/`critical`), recorded as a
    `request_priority_changed` event; because the bucket is compared first, this
    can jump a request ahead of anything in a lower bucket.
  - an **escalation** (domain `escalateDispatchRequest`, invoked by the
    `escalateRequest` dispatcher action) sets the **override rank** to move a
    request ahead **within its bucket**.

  **Neither override rewrites the original `requestedAt`.** Absent an explicit
  priority override or escalation, a request never loses its place because of a
  decline, an expired preferred-driver hold, or reassignment — its original age
  (`requestedAt`) is always preserved.
- **Preferred driver:** a resident may choose a preferred driver. For a
  **`normal`** request, that driver gets a **24-hour hold** (first access). For
  **`urgent`/`critical`** requests, the preference is honored **only if that
  driver is immediately available**; otherwise the request goes to the fair
  queue so urgent need is not delayed waiting on one driver.
- **One active single-request assignment per driver:** a driver holds
  exactly one request at a time (the `driverRegistry.activeRequestId` lock),
  enforced atomically. Delivery Runs are the deliberate exception
  ([0008](./0008-delivery-runs-batch-dispatch-exception.md)).
- **Assignments, not a browsable list:** an eligible, online driver is
  assigned one request at a time — the assignment is committed before the
  driver can see the delivery's details, and closing the app does not
  release it (see [0021](./0021-assignment-on-visibility-dispatch.md)).
  Releasing too many assigned deliveries within a day triggers a cooldown
  (thresholds are admin-configurable) — this discourages cherry-picking
  while never permanently penalizing a driver.

## Alternatives considered

- **Strict preferred-driver priority always:** rejected — it could delay urgent
  deliveries and let one driver monopolize a resident's requests.
- **A browsable job board (drivers pick freely):** rejected — invites
  cherry-picking and undermines equitable distribution of work.
- **Pure FIFO with no priority:** rejected — ignores genuine urgency (medical,
  vulnerable persons) that the water-situation assessment captures.

## Consequences

- The queue balances need (priority), fairness (age within priority), resident
  preference (bounded hold), and equitable driver workload (one-at-a-time
  assignments + decline cooldown).
- Reported urgency (resident-facing) is deliberately distinct from operational
  `dispatchPriority` (staff-controlled) — self-declared urgency is not blindly
  trusted (see TECHNICAL.md "Do Not Blindly Trust Self-Declared Priority").
- Day-boundary logic (decline counting, daily cooldowns) depends on the fixed
  Saba timezone ([0015](./0015-saba-operational-timezone.md)).

## Operational implications

- Changing any of these thresholds or the ordering is a **public-service policy
  change** and warrants a superseding ADR, not a silent code tweak.
- The preferred-driver hold and priority interactions are subtle; see TECHNICAL.md
  before modifying, and preserve the "original request time is never rewritten"
  invariant.

## References

- [`src/lib/domain/dispatchBatchSelection.ts`](../../src/lib/domain/dispatchBatchSelection.ts)
  (`dispatchQueueCompare`: priority bucket → `dispatchOverrideRank` → `requestedAt`),
  [`src/lib/domain/priority.ts`](../../src/lib/domain/priority.ts) (`priorityRankFor`)
- [`src/lib/domain/dispatch.ts`](../../src/lib/domain/dispatch.ts),
  [`src/lib/domain/preferredDriverPolicy.ts`](../../src/lib/domain/preferredDriverPolicy.ts)
- [`src/lib/domain/waterRequests.ts`](../../src/lib/domain/waterRequests.ts)
  (`changeRequestPriority` — priority override; `escalateDispatchRequest` —
  within-bucket override rank; both audited and both preserve `requestedAt`).
  The `escalateRequest` server action in
  [`src/app/dispatcher/actions.ts`](../../src/app/dispatcher/actions.ts) wraps
  `escalateDispatchRequest`.
- [`src/lib/domain/driverOffers.ts`](../../src/lib/domain/driverOffers.ts),
  [`src/lib/domain/dispatchSettings.ts`](../../src/lib/domain/dispatchSettings.ts)
- TECHNICAL.md "Request Claiming", "Dispatch Assignment", "Priority-Based Dispatch",
  "Preferred Driver Expiration"
- [0021](./0021-assignment-on-visibility-dispatch.md) — supersedes the
  pending-offer acceptance mechanism
