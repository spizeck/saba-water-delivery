#!/usr/bin/env node
/**
 * Prelaunch diagnostic: identify (and optionally clear) stale
 * `activeRequestId` values on driver registry entries.
 *
 * Dry run (default — reports only):
 *   node --env-file=.env.local scripts/reconcile-stale-driver-locks.mjs
 *   node --env-file=.env.local scripts/reconcile-stale-driver-locks.mjs --dry-run
 *
 * Write mode (clears stale locks and records audit events):
 *   node --env-file=.env.local scripts/reconcile-stale-driver-locks.mjs --write
 *
 * This script is a one-time/prelaunch tool. Runtime self-healing is
 * handled by `reconcileActiveRequest()` in the application itself.
 */

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

// ---------------------------------------------------------------------------
// Staleness determination (mirrors activeRequestValidation.ts)
// ---------------------------------------------------------------------------

function classifyLock(requestSnap, linkedUserId) {
  if (!requestSnap || !requestSnap.exists) return "request_missing";
  const data = requestSnap.data();
  if (data.assignedDriverId !== linkedUserId) return "reassigned";
  switch (data.status) {
    case "claimed":
      return null; // valid
    case "delivered":
      return "delivered";
    case "confirmed":
      return "confirmed";
    case "cancelled":
      return "cancelled";
    case "disputed":
      return "disputed";
    default:
      return "not_active";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const writeMode = process.argv.includes("--write");
console.log(`Mode: ${writeMode ? "WRITE (will clear stale locks)" : "DRY RUN (report only)"}\n`);

const driversSnap = await db.collection("driverRegistry").get();
let staleCount = 0;
let validCount = 0;
let noLockCount = 0;

for (const doc of driversSnap.docs) {
  const data = doc.data();
  const activeRequestId = data.activeRequestId ?? null;

  if (!activeRequestId) {
    noLockCount++;
    continue;
  }

  const linkedUserId = data.linkedUserId ?? null;
  const requestSnap = await db.collection("waterRequests").doc(activeRequestId).get();
  const reason = classifyLock(requestSnap, linkedUserId);

  if (reason === null) {
    validCount++;
    console.log(
      `  [VALID] ${data.displayName} (${doc.id}) — activeRequestId=${activeRequestId} — claimed by this driver`,
    );
    continue;
  }

  staleCount++;
  console.log(
    `  [STALE] ${data.displayName} (${doc.id}) — activeRequestId=${activeRequestId} — reason: ${reason}`,
  );

  if (writeMode) {
    const now = FieldValue.serverTimestamp();
    await doc.ref.update({ activeRequestId: null, updatedAt: now, updatedBy: "system" });
    await doc.ref.collection("events").add({
      type: "stale_active_request_cleared",
      actorId: "system",
      actorRole: "system",
      createdAt: now,
      metadata: { staleRequestId: activeRequestId, reason, source: "prelaunch_script" },
    });
    console.log(`         → Cleared and audit event recorded.`);
  }
}

console.log(`\nSummary:`);
console.log(`  Total drivers: ${driversSnap.size}`);
console.log(`  No lock:       ${noLockCount}`);
console.log(`  Valid lock:    ${validCount}`);
console.log(`  Stale lock:    ${staleCount}`);

if (staleCount > 0 && !writeMode) {
  console.log(`\nRe-run with --write to clear stale locks.`);
}

process.exit(0);
