import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import type { FillStation } from "./types";

/**
 * Fill-station domain module (see TECHNICAL.md "Fill Stations").
 *
 * Deliberately minimal: a fill station is just a stable ID, a display
 * name, and an active flag. `ensureDefaultFillStations()` idempotently
 * provisions the three known stations if they don't exist yet — this is
 * safe to call on every read (no destructive behavior, nothing customer-
 * facing) and avoids requiring a manual Firestore console step, unlike
 * the driver roster seed which is a deliberate admin-triggered action
 * (see driverRegistry.ts).
 */

const FILL_STATIONS_COLLECTION = "fillStations";

const DEFAULT_STATIONS: FillStation[] = [
  { id: "bottom", name: "Bottom Fill Station", active: true },
  { id: "wws", name: "W.W.S. Fill Station", active: true },
  { id: "hells-gate", name: "Hells Gate Fill Station", active: true },
];

function toFillStation(id: string, data: DocumentData): FillStation {
  return {
    id,
    name: data.name ?? id,
    active: data.active ?? true,
  };
}

/** Idempotently creates the default fill stations if missing. Never overwrites existing docs. */
export async function ensureDefaultFillStations(): Promise<void> {
  const db = getAdminDb();
  await Promise.all(
    DEFAULT_STATIONS.map(async (station) => {
      const ref = db.collection(FILL_STATIONS_COLLECTION).doc(station.id);
      const doc = await ref.get();
      if (doc.exists) return;
      await ref.set({
        name: station.name,
        active: station.active,
        createdAt: FieldValue.serverTimestamp(),
      });
    }),
  );
}

/** Returns all fill stations (including inactive ones — callers filter as needed). */
export async function getFillStations(): Promise<FillStation[]> {
  await ensureDefaultFillStations();
  const db = getAdminDb();
  const snapshot = await db.collection(FILL_STATIONS_COLLECTION).orderBy("name", "asc").get();
  return snapshot.docs.map((doc) => toFillStation(doc.id, doc.data()));
}
