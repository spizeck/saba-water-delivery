import "server-only";

import { Resend } from "resend";

import {
  buildDeliveryConfirmationEmailPayload,
  getDeliveryConfirmationEmailConfig,
  type DeliveryConfirmationEmailInput,
} from "./deliveryConfirmationEmailContent";

export interface SendDeliveryConfirmationEmailResult {
  ok: boolean;
  resendId?: string;
  /** Human-readable provider error message (may embed PII — never persisted). */
  error?: string;
  /** Stable Resend error `name` (e.g. `validation_error`, `rate_limit_exceeded`)
   * used to classify transient vs permanent failures. Safe to log/persist. */
  errorName?: string;
  /** True when the failure is "Resend is not configured" (a terminal,
   * configuration-disabled outcome — see the durable outbox, issue #53). */
  notConfigured?: boolean;
}

export interface SendDeliveryConfirmationEmailOptions {
  /** Provider idempotency key. Defaults to the deterministic per-request key so
   * Resend de-duplicates retries of the same logical notification. The durable
   * outbox passes the notification's stored key explicitly. */
  idempotencyKey?: string;
}

export async function sendDeliveryConfirmationEmail(
  input: DeliveryConfirmationEmailInput,
  options: SendDeliveryConfirmationEmailOptions = {},
): Promise<SendDeliveryConfirmationEmailResult> {
  const config = getDeliveryConfirmationEmailConfig();
  if (!config) {
    return {
      ok: false,
      notConfigured: true,
      error: "Delivery confirmation email is not configured.",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const payload = buildDeliveryConfirmationEmailPayload(input, config);
    const { data, error } = await resend.emails.send(payload, {
      idempotencyKey:
        options.idempotencyKey ?? `delivery-confirmation-${input.requestId}`,
    });
    if (error)
      return {
        ok: false,
        error: error.message || "Resend returned an error.",
        errorName: error.name,
      };
    return { ok: true, resendId: data?.id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unknown email send error",
    };
  }
}
