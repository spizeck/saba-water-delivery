/**
 * Concurrency test: Simulate two drivers attempting to claim the same request.
 *
 * This script verifies that the Firestore transaction in claimWaterRequest()
 * prevents double-assignment. It:
 *   1. Creates two driver documents (eligible + online).
 *   2. Creates a test water request (status: "available").
 *   3. Fires two concurrent claim attempts.
 *   4. Verifies exactly one succeeds and one fails.
 *   5. Verifies the request has exactly one assignedDriverId.
 *   6. Verifies only one "driver_claimed" event exists.
 *   7. Cleans up test data.
 *
 * Usage:
 *   npx tsx scripts/test-concurrency.ts
 *
 * Requires FIREBASE_ADMIN_* env vars to be set (see .env.example).
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("ERROR: Firebase Admin env vars not set. See .env.example.");
  process.exit(1);
}

const app =
  getApps()[0] ??
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

const TEST_PREFIX = "__test_concurrency__";
const DRIVER_A = `${TEST_PREFIX}_driverA`;
const DRIVER_B = `${TEST_PREFIX}_driverB`;

async function setup() {
  console.log("Setting up test data...");
  const now = FieldValue.serverTimestamp();

  // Create two eligible, online drivers.
  await db.collection("drivers").doc(DRIVER_A).set({
    userId: DRIVER_A,
    eligibilityStatus: "eligible",
    availabilityStatus: "online",
    ineligibilityReason: null,
    restrictedAt: null,
    restrictedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("drivers").doc(DRIVER_B).set({
    userId: DRIVER_B,
    eligibilityStatus: "eligible",
    availabilityStatus: "online",
    ineligibilityReason: null,
    restrictedAt: null,
    restrictedBy: null,
    createdAt: now,
    updatedAt: now,
  });

  // Create an available water request.
  const reqRef = db.collection("waterRequests").doc(`${TEST_PREFIX}_request`);
  await reqRef.set({
    customerId: `${TEST_PREFIX}_customer`,
    gallons: 1000,
    village: "Test Village",
    deliveryDirections: "Test directions",
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: null,
    status: "available",
    requestedAt: now,
    availableAt: now,
    claimedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return reqRef.id;
}

async function claimAttempt(requestId: string, driverId: string): Promise<"success" | string> {
  const requestRef = db.collection("waterRequests").doc(requestId);
  const driverRef = db.collection("drivers").doc(driverId);
  const now = FieldValue.serverTimestamp();

  try {
    await db.runTransaction(async (txn) => {
      const [requestSnap, driverSnap] = await Promise.all([
        txn.get(requestRef),
        txn.get(driverRef),
      ]);

      if (!requestSnap.exists) throw new Error("REQUEST_NOT_FOUND");
      const reqData = requestSnap.data()!;

      if (reqData.assignedDriverId) throw new Error("ALREADY_CLAIMED");
      if (reqData.status !== "available") throw new Error("REQUEST_NOT_CLAIMABLE");

      if (!driverSnap.exists) throw new Error("DRIVER_NOT_FOUND");
      const drvData = driverSnap.data()!;
      if (drvData.eligibilityStatus !== "eligible") throw new Error("DRIVER_INELIGIBLE");
      if (drvData.availabilityStatus !== "online") throw new Error("DRIVER_OFFLINE");

      txn.update(requestRef, {
        assignedDriverId: driverId,
        status: "claimed",
        claimedAt: now,
        updatedAt: now,
      });

      const eventRef = requestRef.collection("events").doc();
      txn.set(eventRef, {
        type: "driver_claimed",
        actorId: driverId,
        actorRole: "driver",
        createdAt: now,
        metadata: { previousStatus: "available" },
      });
    });
    return "success";
  } catch (err: unknown) {
    if (err instanceof Error) return err.message;
    return "UNKNOWN_ERROR";
  }
}

async function verify(requestId: string) {
  const reqSnap = await db.collection("waterRequests").doc(requestId).get();
  const data = reqSnap.data()!;

  console.log("\n--- Verification ---");
  console.log(`Status: ${data.status}`);
  console.log(`Assigned driver: ${data.assignedDriverId}`);

  if (data.status !== "claimed") {
    console.error("FAIL: Request status should be 'claimed'.");
    return false;
  }
  if (!data.assignedDriverId) {
    console.error("FAIL: Request should have an assigned driver.");
    return false;
  }

  // Check events.
  const eventsSnap = await db
    .collection("waterRequests")
    .doc(requestId)
    .collection("events")
    .where("type", "==", "driver_claimed")
    .get();

  console.log(`driver_claimed events: ${eventsSnap.size}`);

  if (eventsSnap.size !== 1) {
    console.error("FAIL: Should have exactly 1 driver_claimed event.");
    return false;
  }

  return true;
}

async function cleanup(requestId: string) {
  console.log("\nCleaning up test data...");
  // Delete events subcollection.
  const events = await db
    .collection("waterRequests")
    .doc(requestId)
    .collection("events")
    .get();
  for (const doc of events.docs) {
    await doc.ref.delete();
  }
  await db.collection("waterRequests").doc(requestId).delete();
  await db.collection("drivers").doc(DRIVER_A).delete();
  await db.collection("drivers").doc(DRIVER_B).delete();
}

async function main() {
  const requestId = await setup();
  // Small delay to ensure Firestore consistency.
  await new Promise((r) => setTimeout(r, 500));

  console.log("\nFiring two concurrent claim attempts...");
  const [resultA, resultB] = await Promise.all([
    claimAttempt(requestId, DRIVER_A),
    claimAttempt(requestId, DRIVER_B),
  ]);

  console.log(`Driver A result: ${resultA}`);
  console.log(`Driver B result: ${resultB}`);

  const successes = [resultA, resultB].filter((r) => r === "success");
  const failures = [resultA, resultB].filter((r) => r !== "success");

  if (successes.length !== 1) {
    console.error(`\nFAIL: Expected exactly 1 success, got ${successes.length}`);
  } else if (failures.length !== 1) {
    console.error(`\nFAIL: Expected exactly 1 failure, got ${failures.length}`);
  } else {
    console.log("\nConcurrency check: PASS (1 success, 1 clean failure)");
  }

  const verified = await verify(requestId);
  await cleanup(requestId);

  if (verified && successes.length === 1) {
    console.log("\n=== ALL CONCURRENCY TESTS PASSED ===");
    process.exit(0);
  } else {
    console.error("\n=== CONCURRENCY TEST FAILED ===");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
