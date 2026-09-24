# Dispatcher Guide

[Home](Home.md) · Screen instructions: [canonical Dispatcher Guide](https://github.com/spizeck/saba-water-delivery/blob/main/docs/DISPATCHER_GUIDE.md) · Rules: [PRODUCT.md](https://github.com/spizeck/saba-water-delivery/blob/main/PRODUCT.md)

## Monitor and prioritize

Open the Dispatcher portal and review new requests, preferred-driver holds, aging requests, claimed work, deliveries awaiting confirmation, disputes, and driver availability. Claimed requests represent unfinished physical work; delivered requests awaiting receipt review do not keep drivers busy.

Priority is **Critical, then Urgent, then Normal**. Vulnerable circumstances or a self-reported critical situation produce an initial Critical priority; otherwise it is Normal. Urgent is a staff override. Staff should assess the explanation and circumstances rather than treating priority as a promise of a delivery time.

**Change Priority** changes the priority category and requires a reason. **Escalate** records a request to move ahead within its existing category and also requires a reason. Priority is considered first, staff ordering within the category next, and original request time resolves remaining ties. This describes the intended comparator order. Automatic assignment pages the complete eligible queue in canonical order, so a newer escalated request is not hidden behind older same-priority work; existing assignments are not replaced by escalation. Check assignment progress and use the supported manual assignment or Delivery Run tools when intervention is needed. These actions are audited and preserve the submitted time. A decline, reassignment, or expired preference does not reset the request's age.

## Enter and edit requests

Use **Create Request** for callers and visitors. Select a registered resident after checking their identity, or enter an unregistered person's name, phone, village, directions, and optional email. Both routes enter the same queue. Choose one or two loads and review the details before submission.

An existing unresolved request blocks another request for the same registered resident. A matching phone on an unregistered request produces a warning: a shared phone is not proof of identity, so review the match and explicitly acknowledge any justified continuation. Account setup invitations are optional; invitation failure does not cancel the water request.

Before claim, **Edit request** can correct contact details, location, directions, quantity, and Notes / Comments. Quantity cannot change after collection records exist. Request edits are audited. Edits normally affect the request only; the explicit profile-update option can also update a registered customer's contact details. It does not change their sign-in credentials. Once claimed, these request fields are locked; use the appropriate operational action or seek support.

## Assign work and use Delivery Runs

Assign or reassign to an eligible, linked driver after checking their workload and the request's preference. Normal automatic assignments follow the availability and cooldown rules in [Driver Guide](Driver-Guide.md). A preferred-driver choice is limited first access, not a guarantee; Urgent/Critical requests bypass a hold when that driver cannot take immediate work.

Use **Delivery Runs** to deliberately assign several requests to one driver, for example when using a printed list during poor connectivity. A run can be assigned to an eligible, account-linked driver even while offline or in cooldown. The screen shows workload; overriding a different preferred driver's hold requires explicit acknowledgement. Review request count, load count, and gallons before creating the run.

Each request stays separate for collection, delivery, and receipt review. Print the run sheet when useful and reconcile it with the driver. Reprints reflect current state. Reassigning or cancelling one member removes it from the run without cancelling the others. A run awaiting confirmation has no remaining physical work, even though receipt review is still pending.

## Record delivery and handle problems

Drivers record collection for every load. Staff can reconcile missing collection records with a verification note and checked station/meter information. Only after all loads are collected and the full quantity is actually delivered should **Mark Delivered** be used. Staff can record this for any claimed request, including ordinary assignments and Delivery Runs; history identifies it as staff-recorded.

Registered residents confirm or dispute their own delivered requests. Investigate an existing dispute and use the supported resolution action to confirm completion or reopen delivery. For an unregistered customer, staff can record **Confirm Delivery** after verifying receipt. Staff cannot currently create a formal dispute for that customer: handle the complaint through office coordination and retain an appropriate record while [#50](https://github.com/spizeck/saba-water-delivery/issues/50) remains open. Do not create a fake resident account to simulate their dispute.

See [Operations](Operations.md) for continuity reports and outages. The [draft review notes](README.md) record corrections to stale statements in canonical documents about staff delivery recording and queue ordering.
