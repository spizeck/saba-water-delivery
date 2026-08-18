import "server-only";

import { FieldValue } from "firebase-admin/firestore";

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

export async function getDispatchSettings(): Promise<DispatchSettings> {
  const db = getAdminDb();
  const doc = await db.collection(CONFIG_COLLECTION).doc(DISPATCH_SETTINGS_DOC).get();

  if (!doc.exists) return defaults();

  const data = doc.data()!;
  const fallback = defaults();

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

export interface UpdateDispatchSettingsInput {
  maxDeclinesPerDay: number;
  declineCooldownHours: number;
  actorId: string;
}

/**
 * Updates dispatch settings. Admin-only — authorization must be enforced
 * by the caller (see src/app/admin/actions.ts). Records a
 * `dispatch_settings_updated` audit event with the old and new values.
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
  const now = FieldValue.serverTimestamp();

  const previous = await getDispatchSettings();

  await ref.set(
    {
      maxDeclinesPerDay,
      declineCooldownHours,
      updatedAt: now,
      updatedBy: actorId,
    },
    { merge: true },
  );

  await ref.collection("events").add({
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

  return getDispatchSettings();
}
