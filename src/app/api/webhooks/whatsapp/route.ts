import { NextResponse, type NextRequest } from "next/server";

import { getWhatsAppClientConfig, verifyWhatsAppWebhookChallenge, verifyWhatsAppWebhookSignature } from "@/lib/whatsapp/client";
import { handleIncomingWhatsAppMessage } from "@/lib/whatsapp/handleIncomingMessage";
import { claimMessageId } from "@/lib/whatsapp/idempotency";

/**
 * Meta WhatsApp Cloud API webhook — see PRODUCT.md / TECHNICAL.md
 * "WhatsApp Resident Ordering". Publicly reachable (Meta cannot send a
 * Firebase session cookie), secured instead by:
 *   - GET: Meta's verify-token handshake (`hub.verify_token`).
 *   - POST: `X-Hub-Signature-256` HMAC signature over the raw body,
 *     using `WHATSAPP_APP_SECRET`.
 *
 * Every inbound message is deduplicated by Meta's message ID BEFORE any
 * conversation processing (see PRODUCT.md "Webhook Idempotency") — this
 * is launch-critical, since Meta may retry webhook delivery and a
 * retry must never advance the conversation, create a duplicate
 * request, or confirm/dispute a delivery twice.
 */

interface WhatsAppInboundMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppInboundMessage[];
      };
    }>;
  }>;
}

function extractMessages(payload: WhatsAppWebhookPayload): WhatsAppInboundMessage[] {
  const messages: WhatsAppInboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        messages.push(message);
      }
    }
  }
  return messages;
}

export async function GET(request: NextRequest) {
  const config = getWhatsAppClientConfig();
  if (!config) {
    return NextResponse.json({ error: "WhatsApp is not configured." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const challenge = verifyWhatsAppWebhookChallenge(config, {
    mode: searchParams.get("hub.mode"),
    token: searchParams.get("hub.verify_token"),
    challenge: searchParams.get("hub.challenge"),
  });

  if (challenge === null) {
    return NextResponse.json({ error: "Verification failed." }, { status: 403 });
  }
  return new Response(challenge, { status: 200 });
}

export async function POST(request: NextRequest) {
  const config = getWhatsAppClientConfig();
  if (!config) {
    return NextResponse.json({ error: "WhatsApp is not configured." }, { status: 503 });
  }

  // Signature is computed over the exact raw bytes — read as text
  // BEFORE any JSON parsing.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppWebhookSignature(config, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const messages = extractMessages(payload);

  // Respond to Meta promptly (see PRODUCT.md "Webhook Performance") —
  // this loop is a handful of small Firestore reads/writes and one
  // outbound Meta API call per message, no large scans, no queue.
  for (const message of messages) {
    const isNew = await claimMessageId(message.id);
    if (!isNew) continue; // Meta retry of a message we've already processed — skip entirely.

    try {
      await handleIncomingWhatsAppMessage(message.from, message.text?.body ?? "");
    } catch (err) {
      // A failure processing one message must never fail the whole
      // webhook response (Meta would just retry, and we've already
      // claimed the message ID, so it wouldn't retry-safely anyway) —
      // log and continue.
      console.error("[whatsapp webhook] failed to process message:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true });
}
