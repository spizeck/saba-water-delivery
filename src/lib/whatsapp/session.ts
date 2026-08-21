import "server-only";

/**
 * Firestore-backed WhatsApp conversation session storage — see
 * PRODUCT.md / TECHNICAL.md "WhatsApp Resident Ordering". Sessions are
 * ephemeral conversation scratch state only, never the authoritative
 * record of a water request (see DEVIN.md "Do not store authoritative
 * application state inside WhatsApp conversations").
 *
 * The document ID is a SHA-256 hash of the normalized sender phone
 * number, not the raw phone number itself, so a Firestore console
 * browse of `whatsappSessions` doesn't casually expose phone numbers in
 * document paths (see PRODUCT.md item 8). The normalized phone is still
 * stored as a field inside the document, since the conversation logic
 * needs it (e.g. to default an unregistered customer's contact phone).
 */

import { createHash } from "crypto";

import { appConfig } from "@/lib/domain/config";
import { getAdminDb } from "@/lib/firebase/admin";

import { normalizePhoneForMatching } from "./phoneMatching";
import type { WhatsAppSession } from "./types";

const COLLECTION = "whatsappSessions";

export function sessionIdForPhone(rawPhone: string): string {
  const normalized = normalizePhoneForMatching(rawPhone) ?? rawPhone;
  return createHash("sha256").update(normalized).digest("hex");
}

function isExpired(session: WhatsAppSession, now: Date): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

function freshSession(senderPhone: string, now: Date): WhatsAppSession {
  const normalized = normalizePhoneForMatching(senderPhone) ?? senderPhone;
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + appConfig.whatsappSessionExpirationHours * 60 * 60 * 1000,
  ).toISOString();
  return {
    id: sessionIdForPhone(senderPhone),
    senderPhone: normalized,
    customerId: null,
    customerType: "unknown",
    step: "menu",
    draft: {},
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt,
  };
}

/**
 * Loads the session for this sender phone, returning a fresh
 * ("menu"/empty-draft) session if none exists yet or the existing one
 * has expired (see PRODUCT.md "Session Expiration") — an expired
 * conversation never resumes with stale draft data.
 */
export async function getOrCreateSession(senderPhone: string, now: Date = new Date()): Promise<WhatsAppSession> {
  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(sessionIdForPhone(senderPhone));
  const snap = await ref.get();

  if (!snap.exists) return freshSession(senderPhone, now);

  const data = snap.data() as WhatsAppSession;
  if (isExpired(data, now)) return freshSession(senderPhone, now);
  return data;
}

/** Persists the session, refreshing `updatedAt`/`expiresAt`. */
export async function saveSession(session: WhatsAppSession, now: Date = new Date()): Promise<void> {
  const db = getAdminDb();
  const expiresAt = new Date(
    now.getTime() + appConfig.whatsappSessionExpirationHours * 60 * 60 * 1000,
  ).toISOString();
  const toSave: WhatsAppSession = { ...session, updatedAt: now.toISOString(), expiresAt };
  await db.collection(COLLECTION).doc(session.id).set(toSave);
}
