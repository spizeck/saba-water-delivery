import "server-only";

/**
 * Inbound-webhook idempotency — see PRODUCT.md / TECHNICAL.md "WhatsApp
 * Webhook Idempotency". Meta may retry webhook delivery for the same
 * message; this is launch-critical to prevent a retry from advancing
 * the conversation twice, creating a duplicate water request,
 * confirming a delivery twice, or creating duplicate audit events (see
 * PRODUCT.md item 24).
 *
 * Uses Firestore's `create()` (fails if the document already exists) as
 * an atomic "claim" — the first delivery of a given message ID
 * succeeds and proceeds to process the message; any retry of the same
 * message ID fails to claim it and is skipped entirely.
 *
 * The document ID is a SHA-256 hash of Meta's message ID rather than
 * the raw ID, since Meta message IDs (e.g. "wamid.HBg...==") can contain
 * characters (like `/`) that are not safe to use directly as a
 * Firestore document ID.
 */

import { createHash } from "crypto";

import { getAdminDb } from "@/lib/firebase/admin";

const COLLECTION = "whatsappProcessedMessages";

function docIdForMessageId(messageId: string): string {
  return createHash("sha256").update(messageId).digest("hex");
}

/**
 * Attempts to claim `messageId` as newly seen. Returns `true` the first
 * time (caller should process the message), `false` if it has already
 * been claimed (caller must skip processing and just return 200 so
 * Meta stops retrying).
 */
export async function claimMessageId(messageId: string, now: Date = new Date()): Promise<boolean> {
  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(docIdForMessageId(messageId));
  try {
    await ref.create({ messageId, processedAt: now.toISOString() });
    return true;
  } catch {
    // create() throws ALREADY_EXISTS if the document is already there —
    // that's the expected "duplicate delivery" case, not a real error.
    return false;
  }
}
