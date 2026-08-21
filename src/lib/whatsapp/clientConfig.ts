/**
 * Pure WhatsApp Cloud API configuration/verification logic — factored
 * out of `client.ts` (which has a `server-only` guard because it makes
 * the actual outbound Meta API call) so it can be unit tested directly
 * without mocking crypto or network calls, same pattern as
 * `continuityReportEmailContent.ts`.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface WhatsAppClientConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
}

/** Reads and validates WhatsApp Cloud API configuration. Returns null (never throws) if incomplete. */
export function getWhatsAppClientConfig(): WhatsAppClientConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken) return null;
  return { accessToken, phoneNumberId, appSecret, verifyToken };
}

/**
 * Verifies Meta's webhook GET handshake
 * (`hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`).
 * Returns the challenge string to echo back if valid, or null if the
 * mode/token don't match (caller should respond 403).
 */
export function verifyWhatsAppWebhookChallenge(
  config: WhatsAppClientConfig,
  params: { mode: string | null; token: string | null; challenge: string | null },
): string | null {
  if (params.mode !== "subscribe") return null;
  if (!params.token || params.token !== config.verifyToken) return null;
  return params.challenge;
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request
 * body using HMAC-SHA256 with `WHATSAPP_APP_SECRET`. Must be called
 * with the raw (unparsed) request body — the signature is computed over
 * exact bytes, not the re-serialized JSON. Uses a constant-time
 * comparison to avoid a timing side-channel.
 */
export function verifyWhatsAppWebhookSignature(
  config: WhatsAppClientConfig,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const [algo, providedHex] = signatureHeader.split("=");
  if (algo !== "sha256" || !providedHex) return false;

  const expectedHex = createHmac("sha256", config.appSecret).update(rawBody, "utf8").digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
