#!/usr/bin/env node
/**
 * Read-only disaster-recovery validation (issue #35).
 *
 * Inspects a Firestore database and reports cross-document inconsistencies that
 * a restore (or a bad deployment / partial data incident) could introduce —
 * stale driver locks, claimed requests with a broken driver assignment,
 * delivery-run membership pointing at missing requests, and orphaned request
 * ownership. It NEVER mutates anything and prints only opaque document IDs and
 * categorical reasons (no names, emails, phones, or other personal data).
 *
 * Intended targets, in order of preference (never run a "fix" here — this is a
 * diagnostic; use the documented targeted-repair tools for remediation):
 *
 *   1. A restore drill in the Firestore EMULATOR (no cloud cost):
 *        firebase emulators:exec --only firestore \
 *          "node scripts/verify-recovery.mjs"
 *      (the emulator sets FIRESTORE_EMULATOR_HOST; no credentials needed)
 *
 *   2. A restored copy in an ISOLATED/TEST GCP project (never production in
 *      place). Provide read-only credentials:
 *        FIREBASE_SERVICE_ACCOUNT_KEY='<service-account-json>' \
 *          node scripts/verify-recovery.mjs
 *
 * Exit code is 0 when no inconsistencies are found, 1 when any are found (so it
 * can gate a restore drill). See docs/DISASTER_RECOVERY.md.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { runRecoveryChecks } from "./lib/recovery-checks.mjs";

// ---------------------------------------------------------------------------
// Firebase init — emulator (no creds) or an explicit service account.
// ---------------------------------------------------------------------------

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (getApps().length === 0) {
  if (usingEmulator) {
    initializeApp({
      projectId:
        process.env.GCLOUD_PROJECT ??
        process.env.FIREBASE_ADMIN_PROJECT_ID ??
        "demo-recovery-drill",
    });
  } else {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountJson) {
      console.error(
        "Missing FIRESTORE_EMULATOR_HOST (for an emulator drill) or " +
          "FIREBASE_SERVICE_ACCOUNT_KEY (for an isolated/test project).\n" +
          "Refusing to run without an explicit target. See docs/DISASTER_RECOVERY.md.",
      );
      process.exit(2);
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  }
}

const db = getFirestore();

// ---------------------------------------------------------------------------
// Read the collections the checks need (top-level only; read-only).
// ---------------------------------------------------------------------------

async function readCollection(name, fields) {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    /** @type {Record<string, unknown>} */
    const picked = { id: doc.id };
    for (const field of fields) picked[field] = data[field] ?? null;
    return picked;
  });
}

console.log(
  `Disaster-recovery validation — target: ${
    usingEmulator
      ? `emulator (${process.env.FIRESTORE_EMULATOR_HOST})`
      : "service account"
  }\n`,
);

const [drivers, requests, batches, users] = await Promise.all([
  readCollection("driverRegistry", [
    "linkedUserId",
    "activeRequestId",
    "archivedAt",
  ]),
  readCollection("waterRequests", [
    "status",
    "assignedDriverId",
    "customerId",
    "dispatchBatchId",
  ]),
  readCollection("dispatchBatches", ["originalRequestIds", "status"]),
  // users: only the doc id (uid) is needed for ownership checks.
  readCollection("users", []),
]);

const { findings, summary } = runRecoveryChecks({
  drivers,
  requests,
  batches,
  users,
});

console.log("Scanned:");
console.log(`  driverRegistry:  ${summary.counts.drivers}`);
console.log(`  waterRequests:   ${summary.counts.requests}`);
console.log(`  dispatchBatches: ${summary.counts.batches}`);
console.log(`  users:           ${summary.counts.users}\n`);

if (findings.length === 0) {
  console.log("No cross-document inconsistencies found. ✓");
  process.exit(0);
}

console.log(`Found ${findings.length} inconsistency(ies):\n`);
for (const finding of findings) {
  console.log(`  [${finding.category}] ${finding.id} — ${finding.detail}`);
}
console.log("\nBy category:");
for (const [category, count] of Object.entries(summary.byCategory)) {
  console.log(`  ${category}: ${count}`);
}
console.log(
  "\nThis tool does not mutate data. Use the documented targeted-repair " +
    "procedures (see docs/DISASTER_RECOVERY.md) to remediate.",
);
process.exit(1);
