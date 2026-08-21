import "server-only";

/**
 * Meta WhatsApp Business Platform (Cloud API) transport — see
 * PRODUCT.md / TECHNICAL.md "WhatsApp Resident Ordering". This is the
 * ONLY module that knows about Meta's HTTP API conventions; the
 * conversation engine and webhook route never construct Meta
 * request/response shapes directly, so a future provider change (or a
 * Graph API version bump) stays isolated here.
 *
 * Configuration reading and webhook verification are pure logic in
 * `clientConfig.ts` (no `server-only` guard) so they can be unit tested
 * directly; this file adds only the actual outbound network call.
 */

export {
  getWhatsAppClientConfig,
  verifyWhatsAppWebhookChallenge,
  verifyWhatsAppWebhookSignature,
  type WhatsAppClientConfig,
} from "./clientConfig";

import type { WhatsAppClientConfig } from "./clientConfig";

const GRAPH_API_VERSION = "v21.0";

/** Sends a plain-text WhatsApp message via the Cloud API. Never throws for a Meta API error — returns `{ ok, error? }`. */
export async function sendWhatsAppTextMessage(
  config: WhatsAppClientConfig,
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      },
    );

    if (!response.ok) {
      // Never log the access token; the response body is Meta's own
      // (non-secret) error description.
      const errorText = await response.text();
      return { ok: false, error: `Meta API error ${response.status}: ${errorText.slice(0, 500)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown WhatsApp send error";
    return { ok: false, error: message };
  }
}
