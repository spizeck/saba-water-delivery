# 0021. Assignment-on-visibility dispatch

- **Status:** Accepted
- **Date:** ADR recorded 2026-10-XX (decision made for issue #123; exact
  merge date set at release)

## Context

The original driver workflow ([0007](./0007-dispatch-fairness-and-preferred-driver-policy.md))
was modeled on delivery-platform offers: the driver portal selected a
candidate request, wrote a pending `driverOffers` document, and displayed the
full customer/delivery details with explicit "Accept Delivery" / "Decline"
buttons. The request itself stayed `available` and unassigned until the
driver pressed Accept.

Operationally, drivers treated a displayed delivery as their job: they could
close the phone and physically deliver without pressing Accept. Because the
request remained `available`, another driver could later receive the same
pending offer and claim it — producing real double deliveries in production
(issue #123).

Two alternative fixes were rejected by the operational requirements:

- **Hide customer details until acceptance** — drivers need the customer's
  identity/details to decide whether to serve them.
- **A short-lived offer lease** — a driver can see the delivery, close the
  phone, and continue making the delivery after the lease expires.

The root cause was architectural, not a UI bug: the system showed delivery
details derived from a *non-authoritative* state (a pending offer) while the
authoritative state (the request document) still said `available`.

## Decision

**If an eligible online driver can see the full details of a delivery, that
delivery is already authoritatively assigned to that driver.**

- `assignNextDeliveryForDriver()` replaces `getNextOfferForDriver()` as the
  `/driver` portal entry point. It selects the next canonical candidate and
  calls `claimWaterRequest()` **before** returning any request object — the
  claim transaction is the only path that produces a driver-visible delivery.
- `claimWaterRequest()` remains the single atomic assignment authority. It
  gained an `additionalWrites(txn)` hook so the `driverOffers` dispatch
  record is committed in the same transaction as the claim — an assignment
  can never exist without its ledger entry.
- `driverOffers` is redefined as an **append-only dispatch-decision
  ledger**, not a pending-offer store. `response` values: `"assigned"`
  (auto-assignment committed with the claim), `"declined"` (explicit
  release), `"expired"` (legacy pending or superseded records),
  `"accepted"` (legacy-only, pre-#123 records). Current code never creates
  `response: null` documents.
- **Explicit release replaces decline.** `releaseAssignedDelivery()`
  transactionally verifies ownership and `claimed` status, rejects release
  after collection begins or for Delivery Run members, returns the request
  to `available` at its original `requestedAt`, clears
  `activeRequestId`, records a `"declined"` ledger record, applies the
  existing decline-count/cooldown policy, and writes a `driver_released`
  audit event.
- **No acceptance action and no timeout release.** There is no "Accept
  Delivery" button and no offer lease. Closing the app, losing connectivity,
  or phone sleep do nothing; only release, reassignment, cancellation, or
  completion end an assignment.
- **Legacy pending offers are retired, never honored.** Deployment-time
  `response: null` documents are expired opportunistically during each
  assignment pass. They touch only offer records, never reopen a claimed
  request, and are idempotent.

## Alternatives considered

- **Hide details until accept:** rejected — drivers legitimately need
  customer identity/details before deciding to serve.
- **Offer lease with expiry:** rejected — does not survive "close the phone
  and deliver anyway," and introduces a second timer-driven state machine.
- **Keep pending offers but lock the request document while displayed:**
  rejected — that *is* assignment with extra steps and an ambiguous
  displayed-but-uncommitted state.
- **Delete `driverOffers` entirely:** rejected — it is load-bearing for
  decline history, daily decline counting/cooldown, statistics, and audit.
  Redefining it as a ledger preserves all of that.

## Consequences

- Application state can no longer diverge from driver-visible state: a
  request shown to a driver is never simultaneously `available`.
- Selection remains advisory; claim success is the only authority, so a
  driver who loses a claim race retries the next candidate (bounded to five
  attempts) rather than seeing nothing.
- The driver portal gained a release affordance with a confirmation gate;
  release is hidden for Delivery Run members and once collection begins.
- Statistics can no longer report a meaningful "acceptance rate" — the
  metrics are assignment/release counts; legacy `"accepted"` records remain
  countable for historical continuity.
- Every existing concurrency control still applies: the per-driver
  `activeRequestId` lock, transaction-keyed request mutations, Delivery Run
  exclusion, preferred-driver holds, and decline cooldown.

## Operational implications

- **Online means ready.** Toggling Online no longer merely expresses
  availability — it makes the driver eligible for an immediate authoritative
  assignment on the next `/driver` load.
- **Deployment is self-reconciling.** Pending `driverOffers` records left by
  the old code expire automatically on the first assignment pass per driver;
  no operator script is required. Already-claimed requests are never
  reopened by this sweep.
- **Do not reintroduce a displayed-but-unclaimed state.** Any future channel
  (e.g. WhatsApp) must use `assignNextDeliveryForDriver` /
  `releaseAssignedDelivery` — never render request details before a
  successful claim.
- The `"declined"` ledger response now means "driver released an assigned
  delivery," not "driver declined a pending offer" — both count toward the
  same cooldown policy, but audit readers should note the semantic shift at
  the #123 boundary.

## References

- [`src/lib/domain/dispatch.ts`](../../src/lib/domain/dispatch.ts)
  (`assignNextDeliveryForDriver`, `releaseAssignedDelivery`)
- [`src/lib/domain/waterRequests.ts`](../../src/lib/domain/waterRequests.ts)
  (`claimWaterRequest` with `additionalWrites`)
- [`src/lib/domain/driverOffers.ts`](../../src/lib/domain/driverOffers.ts)
  (dispatch-decision ledger, pending-offer expiry)
- [`src/app/driver/page.tsx`](../../src/app/driver/page.tsx),
  [`src/app/driver/ClaimedDeliveries.tsx`](../../src/app/driver/ClaimedDeliveries.tsx)
- [0007](./0007-dispatch-fairness-and-preferred-driver-policy.md) (fairness
  policy, unchanged; offer mechanism superseded here)
- [0008](./0008-delivery-runs-batch-dispatch-exception.md) (Delivery Run
  exception, unchanged)
- GitHub issue #123 — production double-delivery incident
