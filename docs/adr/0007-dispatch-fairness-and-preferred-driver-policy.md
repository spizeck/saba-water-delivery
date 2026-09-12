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

- **Priority ordering:** `critical` > `urgent` > `normal`. Within a priority
  level, the **oldest request (by original request time) goes first** —
  fairness-by-age. A request never loses its place because of a decline, an
  expired hold, or reassignment; its original `requestedAt` is preserved.
- **Preferred driver:** a resident may choose a preferred driver. For a
  **`normal`** request, that driver gets a **24-hour hold** (first access). For
  **`urgent`/`critical`** requests, the preference is honored **only if that
  driver is immediately available**; otherwise the request goes to the fair
  queue so urgent need is not delayed waiting on one driver.
- **One active single-request assignment per driver:** a driver is offered/holds
  exactly one request at a time (the `driverRegistry.activeRequestId` lock),
  enforced atomically. Delivery Runs are the deliberate exception
  ([0008](./0008-delivery-runs-batch-dispatch-exception.md)).
- **Offers, not a browsable list:** an eligible, online driver is offered one
  request at a time. Declining too many within a day triggers a cooldown
  (thresholds are admin-configurable) — this discourages cherry-picking while
  never permanently penalizing a driver.

## Alternatives considered

- **Strict preferred-driver priority always:** rejected — it could delay urgent
  deliveries and let one driver monopolize a resident's requests.
- **A browsable job board (drivers pick freely):** rejected — invites
  cherry-picking and undermines equitable distribution of work.
- **Pure FIFO with no priority:** rejected — ignores genuine urgency (medical,
  vulnerable persons) that the water-situation assessment captures.

## Consequences

- The queue balances need (priority), fairness (age within priority), resident
  preference (bounded hold), and equitable driver workload (one-at-a-time offers
  + decline cooldown).
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

- [`src/lib/domain/dispatch.ts`](../../src/lib/domain/dispatch.ts),
  [`src/lib/domain/priority.ts`](../../src/lib/domain/priority.ts),
  [`src/lib/domain/preferredDriverPolicy.ts`](../../src/lib/domain/preferredDriverPolicy.ts)
- [`src/lib/domain/driverOffers.ts`](../../src/lib/domain/driverOffers.ts),
  [`src/lib/domain/dispatchSettings.ts`](../../src/lib/domain/dispatchSettings.ts)
- TECHNICAL.md "Request Claiming", "Dispatch Offers", "Priority-Based Dispatch",
  "Preferred Driver Expiration"
