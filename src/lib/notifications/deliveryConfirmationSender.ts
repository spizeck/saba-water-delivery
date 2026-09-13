import "server-only";

import { getUserProfile } from "@/lib/domain/users";
import { getWaterRequestById } from "@/lib/domain/waterRequests";
import { sendDeliveryConfirmationEmail } from "@/lib/email/deliveryConfirmationEmail";

import type { OutboxRecord } from "./outbox";
import { classifyResendError, type SendOutcome } from "./outboxPolicy";

/**
 * Sends the delivery-confirmation email for one outbox record (issue #53).
 *
 * The recipient and content are RECOMPUTED from the referenced request and
 * resident profile at send time — nothing sensitive is read back from the
 * outbox — so a retry always reflects current, authoritative data and no PII is
 * duplicated in the outbox. The eligibility re-check mirrors the pre-outbox
 * behavior exactly:
 *   - Resend not configured        -> terminal `configuration_disabled`
 *   - request gone                 -> terminal `permanent` (subject no longer exists)
 *   - not awaiting confirmation     -> terminal `recipient_ineligible`
 *     (status left "delivered" via confirm/dispute, or reopened) — no stale email
 *   - unregistered requestor        -> terminal `recipient_ineligible`
 *     (an unregistered requestor NEVER receives an authenticated confirmation link)
 *   - registered but not claimed    -> terminal `recipient_ineligible`
 *   - no email on file             -> terminal `recipient_ineligible`
 * On a real send it passes the notification's stored deterministic provider
 * idempotency key so Resend de-duplicates retries.
 */
export async function sendDeliveryConfirmationFromOutbox(
  record: OutboxRecord,
): Promise<SendOutcome> {
  const request = await getWaterRequestById(record.requestId);
  if (!request) {
    // The delivery the notification was about no longer exists — nothing safe
    // to send; do not retry forever.
    return {
      status: "failed",
      category: "permanent",
      reason: "request_not_found",
    };
  }
  if (request.status !== "delivered" || !request.deliveredAt) {
    // Only send while the request is actually AWAITING resident confirmation.
    // Confirmation/dispute change status away from "delivered" but leave
    // `deliveredAt` set, and reopen clears it — in every case the "confirm your
    // delivery" prompt (and its review link) is no longer valid, so a delayed
    // worker run must not send a stale email.
    return {
      status: "failed",
      category: "recipient_ineligible",
      reason: "request_not_awaiting_confirmation",
    };
  }
  if (!request.customerId) {
    return {
      status: "failed",
      category: "recipient_ineligible",
      reason: "unregistered_requestor",
    };
  }

  const profile = await getUserProfile(request.customerId);
  if (!profile || profile.authStatus !== "claimed") {
    return {
      status: "failed",
      category: "recipient_ineligible",
      reason: "resident_not_claimed",
    };
  }
  const recipient = profile.email?.trim();
  if (!recipient) {
    return {
      status: "failed",
      category: "recipient_ineligible",
      reason: "no_email_on_file",
    };
  }

  const result = await sendDeliveryConfirmationEmail(
    {
      to: recipient,
      displayName:
        profile.displayName || request.customer?.displayName || "Resident",
      requestId: record.requestId,
      loads: request.loads,
      gallons: request.gallons,
      village: request.village,
      deliveryDirections: request.deliveryDirections,
      deliveredAt: request.deliveredAt,
    },
    { idempotencyKey: record.providerIdempotencyKey },
  );

  if (result.ok) {
    return { status: "sent", providerMessageId: result.resendId ?? null };
  }
  if (result.notConfigured) {
    return {
      status: "failed",
      category: "configuration_disabled",
      reason: "resend_not_configured",
    };
  }
  return {
    status: "failed",
    category: classifyResendError(result.errorName),
    // Sanitized: the stable provider error NAME only, never the message body.
    reason: result.errorName ?? "resend_error",
  };
}
