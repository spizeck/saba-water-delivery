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
  error?: string;
}

export async function sendDeliveryConfirmationEmail(
  input: DeliveryConfirmationEmailInput,
): Promise<SendDeliveryConfirmationEmailResult> {
  const config = getDeliveryConfirmationEmailConfig();
  if (!config) {
    return {
      ok: false,
      error: "Delivery confirmation email is not configured.",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const payload = buildDeliveryConfirmationEmailPayload(input, config);
    const { data, error } = await resend.emails.send(payload, {
      idempotencyKey: `delivery-confirmation-${input.requestId}`,
    });
    if (error) return { ok: false, error: error.message || "Resend returned an error." };
    return { ok: true, resendId: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email send error",
    };
  }
}
