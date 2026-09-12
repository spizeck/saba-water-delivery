# Resident Workflow

[Home](Home.md) · Canonical rules: [PRODUCT.md](https://github.com/spizeck/saba-water-delivery/blob/main/PRODUCT.md)

## Request water

Sign in with Google or email/password, open the Resident portal, and check your contact details, village, and delivery directions. Choose **1 load (1,000 gallons)** or **2 loads (2,000 gallons)**. A two-load order remains one request with one assignment and one delivery review. Scheduled dates, time slots, and arbitrary gallon quantities are outside the current workflow.

Describe your water situation accurately, including affected people and vulnerable circumstances. A self-reported Critical situation needs a written explanation. Review the request and accept the attestation before submitting. Optional Notes / Comments help staff and the driver understand this delivery; they do not replace the location or quantity fields.

You can have only one unresolved request at a time. Updating your saved profile does not rewrite an existing request. Contact the Water Delivery Office if an existing request needs correction. People without an account can ask the office to enter a request; an email address is not required for that route.

## Preferred driver

You may choose a preferred driver. For Normal requests, the preference gives that driver first access for up to 24 hours. It is not a delivery appointment or guarantee. The request opens to other eligible drivers when the hold expires or the preferred driver declines. Urgent/Critical needs do not wait on a preferred driver who is not immediately available. See [System Concepts](System-Concepts.md) for the queue policy.

## Understand the status

| Status                | Meaning                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested             | The request has entered the system.                                                                                                                  |
| Preferred driver hold | First access is temporarily reserved for the preferred driver.                                                                                       |
| Available             | The request is open for assignment.                                                                                                                  |
| Claimed               | A driver is assigned and physical delivery work remains.                                                                                             |
| Delivered             | The full requested quantity has been recorded as delivered; receipt review is separate.                                                              |
| Confirmed             | Receipt was confirmed by the resident, by staff for an unregistered customer, or automatically after the review window. History distinguishes these. |
| Disputed              | A registered resident reported a problem for staff to resolve.                                                                                       |
| Cancelled             | The request was closed without continuing delivery work; its history remains.                                                                        |

## Review the delivery

After delivery is recorded, use the Resident portal or the **Review Delivery** email link to review receipt while signed into the owning account. Confirm if you received the full quantity; report a problem if you did not. An email link does not itself confirm delivery.

The normal review window is 24 hours from recorded delivery. Without a response, the system auto-confirms when an operational page or workflow next evaluates the expired request; this need not happen at the exact deadline. Report problems promptly. If the request is already confirmed and the dispute action is unavailable, contact the office.

Email is best-effort: failure to receive an email does not undo delivery or extend the window. Staff investigate disputes and can resolve them as completed or reopen the request for delivery.

## Cancellation today

Residents cannot yet cancel their own requests. Contact the office for staff assistance. [Issue #23](https://github.com/spizeck/saba-water-delivery/issues/23) tracks future self-cancellation before dispatch; its proposed controls are not available features.
