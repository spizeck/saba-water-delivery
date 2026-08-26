#!/usr/bin/env node
/**
 * One-time village spelling cleanup for prelaunch Saba Water Delivery data.
 *
 * Run a dry run:
 *   node --env-file=.env.local scripts/migrate-villages.mjs --dry-run
 *
 * Apply changes:
 *   node --env-file=.env.local scripts/migrate-villages.mjs --write
 *
 * The script does NOT change request status, timestamps, or event history.
 * It only rewrites `village` to the canonical spelling where the mapping is
 * unambiguous, and reports any ambiguous/unapproved values for a human
 * decision.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const CANONICAL_VILLAGES = [
  "St Johns",
  "The Bottom",
  "Windwardside",
  "Zions Hill - Lower",
  "Zions Hill - Upper",
];

const UNAMBIGUOUS_MAP = new Map([
  ["St. John's", "St Johns"],
  ["St Johns", "St Johns"],
  ["Bottom", "The Bottom"],
  ["The Bottom", "The Bottom"],
  ["Zion's Hill - Lower", "Zions Hill - Lower"],
  ["Zion's Hill - Upper", "Zions Hill - Upper"],
  ["Zions Hill - Lower", "Zions Hill - Lower"],
  ["Zions Hill - Upper", "Zions Hill - Upper"],
]);

const UNAPPROVED_AMBIGUOUS = new Set([
  "Hells Gate",
  "Hell's Gate",
  "Lower Hells Gate",
  "Upper Hells Gate",
]);

const COLLECTIONS = ["users", "waterRequests"];
const BATCH_LIMIT = 450; // safe margin below Firestore's ~500 write limit

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function canonicalize(village) {
  const v = normalize(village);
  if (CANONICAL_VILLAGES.includes(v)) return { action: "ok", canonical: v };
  if (UNAMBIGUOUS_MAP.has(v)) return { action: "map", canonical: UNAMBIGUOUS_MAP.get(v) };
  if (UNAPPROVED_AMBIGUOUS.has(v)) return { action: "ambiguous", reason: "unapproved village" };
  return { action: "ambiguous", reason: "unknown value" };
}

function initAdmin() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin env vars. Set FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY. " +
        "Run with: node --env-file=.env.local scripts/migrate-villages.mjs --dry-run",
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  return getFirestore();
}

async function processCollection(db, collectionId, writeMode) {
  const snapshot = await db.collection(collectionId).get();

  const toUpdate = [];
  const counts = { ok: 0, map: 0, ambiguous: 0 };
  const mapByOld = new Map();
  const ambiguousByValue = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.village === undefined || data.village === null) continue;

    const result = canonicalize(data.village);

    if (result.action === "ok") {
      counts.ok++;
      continue;
    }

    if (result.action === "map") {
      counts.map++;
      toUpdate.push({ ref: doc.ref, id: doc.id, old: normalize(data.village), new: result.canonical });
      mapByOld.set(result.old, (mapByOld.get(result.old) || 0) + 1);
      continue;
    }

    counts.ambiguous++;
    const key = normalize(data.village);
    ambiguousByValue.set(key, (ambiguousByValue.get(key) || 0) + 1);
  }

  if (writeMode) {
    for (let i = 0; i < toUpdate.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = toUpdate.slice(i, i + BATCH_LIMIT);
      for (const item of chunk) {
        batch.update(item.ref, {
          village: item.new,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  return {
    collectionId,
    counts,
    mapByOld: Object.fromEntries(mapByOld),
    ambiguousByValue: Object.fromEntries(ambiguousByValue),
    wouldUpdate: toUpdate.length,
    actuallyUpdated: writeMode ? toUpdate.length : 0,
  };
}

function printSummary(summary) {
  console.log("\n--- Summary ---");
  for (const s of summary) {
    console.log(`\nCollection: ${s.collectionId}`);
    console.log(`  Already canonical: ${s.counts.ok}`);
    console.log(`  Would be updated: ${s.wouldUpdate}`);
    console.log(`  Actually updated: ${s.actuallyUpdated}`);
    console.log(`  Ambiguous/unknown: ${s.counts.ambiguous}`);
    if (Object.keys(s.mapByOld).length > 0) {
      console.log("  Mapping changes by old value:");
      for (const [old, count] of Object.entries(s.mapByOld)) {
        console.log(`    ${old} -> ${UNAMBIGUOUS_MAP.get(old)} (${count})`);
      }
    }
    if (Object.keys(s.ambiguousByValue).length > 0) {
      console.log("  Ambiguous/unapproved values (not changed):");
      for (const [value, count] of Object.entries(s.ambiguousByValue)) {
        console.log(`    "${value}" (${count})`);
      }
    }
  }
}

async function main() {
  const writeMode = process.argv.includes("--write");
  const dryRun = !writeMode;

  if (process.argv.includes("--help")) {
    console.log("Usage: node --env-file=.env.local scripts/migrate-villages.mjs [--dry-run] [--write]");
    console.log("  --dry-run  Show planned changes without writing (default).");
    console.log("  --write    Actually update Firestore documents.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("--- DRY RUN ---");
  } else {
    console.log("--- WRITE MODE ---");
  }

  const db = initAdmin();
  const summary = [];

  for (const collectionId of COLLECTIONS) {
    const result = await processCollection(db, collectionId, writeMode);
    summary.push(result);
  }

  printSummary(summary);

  const totalWould = summary.reduce((sum, s) => sum + s.wouldUpdate, 0);
  const totalAmbiguous = summary.reduce((sum, s) => sum + s.counts.ambiguous, 0);

  console.log(`\nTotal documents ${writeMode ? "updated" : "that would be updated"}: ${totalWould}`);
  if (totalAmbiguous > 0) {
    console.log(`Total ambiguous/unapproved village values: ${totalAmbiguous}`);
    console.log("These were NOT changed. Review them and ask the government team how to handle each value.");
  }

  if (writeMode) {
    console.log("\nMigration completed.");
  } else {
    console.log("\nDry run complete. Add --write to apply the mapped changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
