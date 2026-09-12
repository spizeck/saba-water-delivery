# 0006. Water request lifecycle and quantity model

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18;
  priority model 2026-08-19; records an existing decision)

## Context

Residents request delivered RO water in standard truck loads. The system needs a
simple, auditable representation of "a request for water" that matches how the
operation actually works on the island, without inventing partial-fulfillment
accounting the business does not use.

## Decision

- **One `waterRequests/{id}` document represents one operational/commercial
  request.** A request is for **1 or 2 loads**, where **each load is 1,000
  gallons** (`RequestedLoads = 1 | 2`, `LOAD_GALLONS = 1000`, gallons derived
  server-side as `loads * 1000`).
- **There is no partial-fulfillment request lifecycle.** `delivered` means the
  full requested quantity was delivered. The request does not split into
  independently-fulfilled sub-requests.
- **Per-load water-collection records still exist** (`loadCollections`) to track
  the physical fill events (which fill station, which meter, when) for a 1- or
  2-load request. These document physical collection; they are not a
  partial-delivery state of the request.
- **Status lifecycle:** `requested` → `preferred_driver_hold` (optional) →
  `available` → `claimed` → `delivered` → `confirmed` | `disputed`, with
  `cancelled` reachable from the open states. Delivery completion and the
  confirmed/disputed accountability states are covered in
  [0009](./0009-delivery-completion-and-resident-confirmation.md); dispatch
  ordering and the preferred-driver hold in
  [0007](./0007-dispatch-fairness-and-preferred-driver-policy.md).
- A request carries a **customer snapshot** and a **water-situation snapshot**
  (reported urgency, vulnerable circumstances) captured at creation time and
  **decoupled from the live profile** — editing the resident's profile never
  rewrites them. The customer snapshot is not strictly immutable, though: an
  authorized dispatcher may edit the request's customer name/phone/email (and
  optionally propagate to the profile) while the request is still `requested`,
  `preferred_driver_hold`, or `available`; each such edit records prior/new values
  in a `request_edited` audit event, and once `claimed` request fields are no
  longer editable. The **water-situation snapshot is immutable** after creation.

## Alternatives considered

- **Arbitrary gallon amounts / partial fulfillment:** rejected — the operation
  delivers standard truck loads; modeling partial gallons or per-load request
  states would add accounting complexity the business does not need.
- **Separate documents per load:** rejected — a request is one commercial unit;
  per-load detail is captured within the request via `loadCollections`.
- **Re-deriving customer/situation data from the live profile:** rejected — the
  request must preserve the facts as they were at request time (auditability).

## Consequences

- Quantity is always 1,000 or 2,000 gallons; UI and reporting can rely on that.
- The two-load case needs two collection records before delivery can be marked,
  but is still a single request that is delivered as a whole.
- Unregistered (dispatcher-entered) customers have no `users/{uid}` document but
  still have a full request via the customer snapshot.

## Operational implications

- Editing quantity is locked once collection records exist (a delivered/partly-
  collected request's quantity is not silently changed).
- "Delivered" is all-or-nothing for the request; there is no half-delivered
  status to reconcile.

## References

- [`src/lib/domain/quantity.ts`](../../src/lib/domain/quantity.ts),
  [`src/lib/domain/types.ts`](../../src/lib/domain/types.ts) (`WaterRequestStatus`,
  `WaterLoadCollection`, snapshots)
- [`src/lib/domain/waterRequests.ts`](../../src/lib/domain/waterRequests.ts)
- TECHNICAL.md "Suggested Firestore Model" (`waterRequests`), "Water Collection
  Tracking"; [`../DATA_MODEL.md`](../DATA_MODEL.md)
