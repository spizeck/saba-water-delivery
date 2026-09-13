import "server-only";

import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { appConfig } from "./config";
import type { DispatchSettings } from "./types";

/**
 * Admin-configurable dispatch settings, backed by a single Firestore
 * document at `config/dispatchSettings`. These control the driver
 * decline-limit/cooldown policy (see TECHNICAL.md "Dispatch Offers").
 *
 * If the document does not exist yet (fresh install, or before any admin
 * has saved settings), safe defaults from `appConfig` are returned without
 * writing anything — the document is only created the first time an
 * admin explicitly saves settings.
 */

const CONFIG_COLLECTION = "config";
const DISPATCH_SETTINGS_DOC = "dispatchSettings";

function defaults(): DispatchSettings {
  return {
    maxDeclinesPerDay: appConfig.defaultMaxDeclinesPerDay,
    declineCooldownHours: appConfig.defaultDeclineCooldownHours,
    updatedAt: null,
    updatedBy: null,
  };
}

/**
 * Derives the effective dispatch settings from a `config/dispatchSettings`
 * snapshot, applying the same fallback/default semantics whether the document
 * is missing entirely or present with individual fields missing/invalid.
 *
 * Shared by `getDispatchSettings()` (a plain read) and the
 * `updateDispatchSettings()` transaction, so the audit event's `oldValues`
 * describe *exactly* the effective state the transaction observed and replaced
 * — including the code-level defaults that apply before any admin has ever
 * saved settings — rather than a stale read taken outside the transaction.
 */
function resolveSettings(snap: DocumentSnapshot): DispatchSettings {
  const fallback = defaults();
  if (!snap.exists) return fallback;

  const data = snap.data()!;
  return {
    maxDeclinesPerDay:
      typeof data.maxDeclinesPerDay === "number"
        ? data.maxDeclinesPerDay
        : fallback.maxDeclinesPerDay,
    declineCooldownHours:
      typeof data.declineCooldownHours === "number"
        ? data.declineCooldownHours
        : fallback.declineCooldownHours,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    updatedBy: data.updatedBy ?? null,
  };
}

export async function getDispatchSettings(): Promise<DispatchSettings> {
  const db = getAdminDb();
  const doc = await db
    .collection(CONFIG_COLLECTION)
    .doc(DISPATCH_SETTINGS_DOC)
    .get();

  return resolveSettings(doc);
}

export interface UpdateDispatchSettingsInput {
  maxDeclinesPerDay: number;
  declineCooldownHours: number;
  actorId: string;
}

/**
 * Updates dispatch settings. Admin-only — authorization must be enforced
 * by the caller (see src/app/admin/actions.ts). Records a
 * `dispatch_settings_updated` audit event with the old and new values.
 *
 * The config write and its required audit event are committed in a **single
 * Firestore transaction**, so the change can never commit without its durable
 * business-history event (issue #49). The `oldValues` are derived from the
 * current document read *inside that same transaction* — including the
 * code-level defaults that apply before any admin has saved settings — so the
 * event always describes the exact state this transaction replaced, even under
 * concurrent updates. Two concurrent updates contend on the single config
 * document and are serialized by Firestore; the loser retries and records the
 * winner's committed values as its `oldValues`.
 */
export async function updateDispatchSettings(
  input: UpdateDispatchSettingsInput,
): Promise<DispatchSettings> {
  const { maxDeclinesPerDay, declineCooldownHours, actorId } = input;

  if (!Number.isInteger(maxDeclinesPerDay) || maxDeclinesPerDay < 1) {
    throw new Error("INVALID_MAX_DECLINES");
  }
  if (!Number.isFinite(declineCooldownHours) || declineCooldownHours <= 0) {
    throw new Error("INVALID_COOLDOWN_HOURS");
  }

  const db = getAdminDb();
  const ref = db.collection(CONFIG_COLLECTION).doc(DISPATCH_SETTINGS_DOC);

  await db.runTransaction(async (txn) => {
    // Read the current config INSIDE the transaction and derive the effective
    // previous values from that snapshot, so `oldValues` reflects exactly what
    // this transaction replaces (never a stale pre-transaction read).
    const snap = await txn.get(ref);
    const previous = resolveSettings(snap);
    const now = FieldValue.serverTimestamp();

    txn.set(
      ref,
      {
        maxDeclinesPerDay,
        declineCooldownHours,
        updatedAt: now,
        updatedBy: actorId,
      },
      { merge: true },
    );

    const eventRef = ref.collection("events").doc();
    txn.set(eventRef, {
      type: "dispatch_settings_updated",
      actorId,
      createdAt: now,
      oldValues: {
        maxDeclinesPerDay: previous.maxDeclinesPerDay,
        declineCooldownHours: previous.declineCooldownHours,
      },
      newValues: {
        maxDeclinesPerDay,
        declineCooldownHours,
      },
    });
  });

  return getDispatchSettings();
}
