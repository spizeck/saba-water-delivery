# System Concepts

[Home](Home.md) · Canonical business rules: [PRODUCT.md](https://github.com/spizeck/saba-water-delivery/blob/main/PRODUCT.md) · Architectural reasoning: [accepted ADRs](https://github.com/spizeck/saba-water-delivery/blob/main/docs/adr/README.md)

## One request, one delivery review

A request represents one customer need for **one or two 1,000-gallon loads**. A two-load request is 2,000 gallons with one priority, assignment, and confirmation/dispute record. Collection is recorded per physical load; it does not create separate partial-delivery statuses.

Requests enter the queue, may spend time on a preferred-driver hold, become available, and are claimed by or assigned to a driver. After physical delivery they become delivered, then confirmed or disputed. Staff cancellation closes work without deleting its history; dispute resolution may reopen a request for delivery. The [Resident Workflow](Resident-Workflow.md) explains each status.

## Fairness and preferences

The canonical queue comparator considers Critical before Urgent before Normal. Within a category, explicit staff escalation ordering takes precedence; original request age resolves remaining ties and orders requests without overrides. A priority override changes the category. An escalation records a within-category rank. Neither rewrites the submitted time. This comparator is applied only to the candidates supplied to it: automatic offers first fetch up to 100 available requests by priority and original age. An escalation outside that set may therefore be missed in favor of older same-priority work. Existing valid offers and preferred-driver holds are handled separately. See [Known Limitations](Known-Limitations-and-Roadmap.md) for the follow-up.

A preferred driver gets limited first access, normally up to 24 hours. For Urgent/Critical requests, the driver must be immediately available or the request opens to general dispatch. Release or expiry ends the hold without resetting request age. A preference does not guarantee a particular driver or arrival time.

Normal dispatch assigns drivers one delivery at a time, discouraging selection of only easy deliveries. The delivery shown to a driver is already atomically assigned to them (assignment-on-visibility, issue #123): there is no accept step, and closing the app does not release it. A driver who will not serve an assignment explicitly releases it. Eligibility, chosen availability, and temporary decline cooldown are different conditions.

## Delivery Runs and physical work

A Delivery Run is a deliberate staff assignment of several requests to one driver, often with a printable run sheet. It uses the same requests and completion rules as ordinary dispatch. Every member is collected and delivered individually.

**Claimed** means unfinished physical work. **Delivered** means the full quantity was recorded as physically delivered and that request no longer keeps the driver busy. A run can be awaiting receipt confirmation after all physical work is done. Its completion label is not proof that every customer personally confirmed receipt; inspect individual history when needed.

## Receipt and accountability

Registered residents confirm or dispute their delivered requests. After the usual 24-hour window, an unanswered request auto-confirms when next evaluated by an operational workflow. That automatic outcome is recorded separately from resident confirmation. Staff confirmation for an unregistered customer is also distinct. Staff-created unregistered disputes remain a [known gap](Known-Limitations-and-Roadmap.md).

Durable audit events explain who changed a request, role, or driver record and when. Application logs explain failures and request processing for technical diagnosis. Logs do not replace audit history. Required audit events now commit in the same Firestore transaction as the change they record, so a sensitive change cannot commit without its audit history; the one exception is deleting a duplicate's Firebase Authentication login during an account merge, which no database transaction can include. That step only deletes (it does not disable), so if it fails the merged-away identity can still sign in until an operator removes it — durable reconciliation of this is tracked in [#73](https://github.com/spizeck/saba-water-delivery/issues/73) (see also [#49](https://github.com/spizeck/saba-water-delivery/issues/49) and ADR 0010).

Exact mechanics and data fields belong in [TECHNICAL.md](https://github.com/spizeck/saba-water-delivery/blob/main/TECHNICAL.md) and [DATA_MODEL.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/DATA_MODEL.md).
