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
 *   2. A restored copy in an ISOLATED/TEST GCP project, or a named recovery
 *      database, using Application Default Credentials from a key FILE (never
 *      inline the JSON on the command line — it lands in shell history and the
 *      process list). Point the app at the correct database with --database:
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *          node scripts/verify-recovery.mjs --database=recovery-YYYYMMDD
 *      (or pass --service-account-file=/path/to/key.json instead of the env var;
 *       or use `gcloud auth application-default login` for ADC).
 *
 * IMPORTANT: validate the SAME database the restore was written into. A managed
 * restore creates a NEW database (e.g. recovery-YYYYMMDD); without --database
 * (or FIREBASE_DATABASE_ID) this reads `(default)`, which could give a false
 * zero-finding pass. The target database is printed below.
 *
 * Exit code is 0 when no inconsistencies are found, 1 when any are found (so it
 * can gate a restore drill), 2 on a configuration/credentials error. See
 * docs/DISASTER_RECOVERY.md.
 */

import { readFileSync } from "node:fs";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { runRecoveryChecks } from "./lib/recovery-checks.mjs";
import { resolveVerifyTarget } from "./lib/recovery-target.mjs";

// ---------------------------------------------------------------------------
// Resolve the target (pure helper — see scripts/lib/recovery-target.mjs).
// A stale FIRESTORE_EMULATOR_HOST alongside explicit cloud config is rejected
// so a cloud validation can never silently pass against an empty local
// emulator. Credentials are NEVER read from an inline command-line value.
// ---------------------------------------------------------------------------

const target = resolveVerifyTarget(process.env, process.argv);

if ("error" in target) {
  console.error(target.error + "\nSee docs/DISASTER_RECOVERY.md.");
  process.exit(2);
}

let credentialSource;

if (getApps().length === 0) {
  if (target.mode === "emulator") {
    credentialSource = `emulator (${target.emulatorHost})`;
    initializeApp({
      projectId:
        process.env.GCLOUD_PROJECT ??
        process.env.FIREBASE_ADMIN_PROJECT_ID ??
        "demo-recovery-drill",
    });
  } else if (target.mode === "service-account-file") {
    // Read the key from a FILE — not from an inline env value on the command
    // line (which would be recorded in shell history and the process list).
    credentialSource = `service-account file (${target.serviceAccountFile})`;
    initializeApp({
      credential: cert(
        JSON.parse(readFileSync(target.serviceAccountFile, "utf8")),
      ),
    });
  } else {
    // Application Default Credentials from the key file GOOGLE_APPLICATION_CREDENTIALS points at.
    credentialSource = `application default credentials (${process.env.GOOGLE_APPLICATION_CREDENTIALS})`;
    initializeApp();
  }
}

const db = target.databaseId
  ? getFirestore(getApps()[0], target.databaseId)
  : getFirestore();

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
  `Disaster-recovery validation\n` +
    `  credentials: ${credentialSource ?? "already-initialized app"}\n` +
    `  database:    ${target.databaseId ?? "(default)"}\n`,
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
