#!/usr/bin/env node
/**
 * Seed the driver registry with the known initial roster.
 *
 * LOCAL / DEVELOPMENT USE ONLY — this script is intentionally NOT part of
 * the production application bundle.  It uses the Firebase Admin SDK
 * directly and requires FIREBASE_SERVICE_ACCOUNT_KEY in the environment.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-initial-roster.mjs
 *
 * The script is idempotent: drivers whose display name (case-insensitive)
 * already exists in the registry are skipped.
 */

import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountJson) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT_KEY in environment.");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
}
const db = getFirestore();

const REGISTRY_COLLECTION = "driverRegistry";
const UNIQUE_KEYS_COLLECTION = "driverRegistryUniqueKeys";

// ---------------------------------------------------------------------------
// Unique-key helper (mirrors driverRegistry.ts)
// ---------------------------------------------------------------------------

function driverUniqueKey(field, value) {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${field}_${hash}`;
}

// ---------------------------------------------------------------------------
// Initial roster
// ---------------------------------------------------------------------------

const INITIAL_ROSTER = [
  {
    displayName: "Government",
    meters: [
      { stationId: "bottom", meterCode: "BTM1", meterNumber: 1 },
      { stationId: "wws", meterCode: "WWS1", meterNumber: 1 },
      { stationId: "hells-gate", meterCode: "HG1", meterNumber: 1 },
    ],
  },
  {
    displayName: "Shanon Levenston",
    meters: [
      { stationId: "bottom", meterCode: "BTM2", meterNumber: 2 },
      { stationId: "wws", meterCode: "WWS2", meterNumber: 2 },
      { stationId: "hells-gate", meterCode: "HG2", meterNumber: 2 },
    ],
  },
  {
    displayName: "Earl Ballentyne",
    meters: [
      { stationId: "bottom", meterCode: "BTM3", meterNumber: 3 },
      { stationId: "wws", meterCode: "WWS3", meterNumber: 3 },
      { stationId: "hells-gate", meterCode: "HG3", meterNumber: 3 },
    ],
  },
  {
    displayName: "Michael Hodge",
    meters: [
      { stationId: "bottom", meterCode: "BTM4", meterNumber: 4 },
      { stationId: "wws", meterCode: "WWS4", meterNumber: 4 },
      { stationId: "hells-gate", meterCode: "HG4", meterNumber: 4 },
    ],
  },
  {
    displayName: "Andy Lavia",
    meters: [
      { stationId: "bottom", meterCode: "BTM5", meterNumber: 5 },
      { stationId: "wws", meterCode: "WWS5", meterNumber: 5 },
      { stationId: "hells-gate", meterCode: "HG5", meterNumber: 5 },
    ],
  },
  {
    displayName: "Eagen Aquasab",
    meters: [
      { stationId: "bottom", meterCode: "BTM6", meterNumber: 6 },
      { stationId: "wws", meterCode: "WWS6", meterNumber: 6 },
      { stationId: "hells-gate", meterCode: "HG6", meterNumber: 6 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ACTOR_ID = "system_seed";

const existingSnap = await db.collection(REGISTRY_COLLECTION).get();
const existingNames = new Set(
  existingSnap.docs.map((d) => (d.data().displayName ?? "").trim().toLowerCase()),
);

let created = 0;
let skipped = 0;

for (const spec of INITIAL_ROSTER) {
  const normalizedName = spec.displayName.trim().toLowerCase();
  if (existingNames.has(normalizedName)) {
    console.log(`  [SKIP] ${spec.displayName} — already exists`);
    skipped++;
    continue;
  }

  const now = FieldValue.serverTimestamp();
  const ref = db.collection(REGISTRY_COLLECTION).doc();
  const nameKeyRef = db
    .collection(UNIQUE_KEYS_COLLECTION)
    .doc(driverUniqueKey("name", normalizedName));

  await db.runTransaction(async (txn) => {
    const nameKey = await txn.get(nameKeyRef);
    if (nameKey.exists) throw new Error(`Unique name key collision for ${spec.displayName}`);

    txn.create(nameKeyRef, { driverId: ref.id, type: "name", createdAt: now });
    txn.create(ref, {
      displayName: spec.displayName.trim(),
      phone: null,
      linkedUserId: null,
      eligibilityStatus: "ineligible",
      availabilityStatus: "offline",
      ineligibilityReason: "Pending government approval",
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      createdAt: now,
      createdBy: ACTOR_ID,
      updatedAt: now,
      updatedBy: ACTOR_ID,
    });
    txn.create(ref.collection("events").doc(), {
      type: "driver_registry_created",
      actorId: ACTOR_ID,
      actorRole: "admin",
      createdAt: now,
      metadata: { displayName: spec.displayName.trim() },
    });
  });

  // Meter assignments (outside the driver-create transaction because
  // they target a subcollection of the newly created document).
  for (const meter of spec.meters) {
    const meterRef = ref.collection("meters").doc(meter.stationId);
    await meterRef.set({
      meterCode: meter.meterCode,
      meterNumber: meter.meterNumber,
      assignedAt: FieldValue.serverTimestamp(),
      assignedBy: ACTOR_ID,
    });
  }

  console.log(`  [CREATED] ${spec.displayName} (${ref.id}) with ${spec.meters.length} meters`);
  created++;
}

console.log(`\nSeed complete: ${created} created, ${skipped} skipped.`);
process.exit(0);
