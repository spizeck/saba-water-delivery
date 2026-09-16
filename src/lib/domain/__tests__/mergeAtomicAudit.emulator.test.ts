import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only firestore + storage emulators run under `npm run test:rules`; point the
// Auth emulator host at its standard (unused) port so the merge's immediate
// Auth reconciliation fails fast with a connection error — the same behavior
// as a production Auth outage. The merge's Firestore effects (the subject of
// these tests) are unaffected, and the failed attempt leaves a durable
// `pending` reconciliation record (issue #73). See phantomAdmin.emulator.test.ts.
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  ADMIN_ROLE_INVARIANT_DOC,
  SYSTEM_INVARIANTS_COLLECTION,
} from "@/lib/domain/admin";
import { mergeUserAccounts } from "@/lib/domain/identity";
import type { UserRole } from "@/lib/domain/types";

/**
 * Emulator-backed regression tests for issue #49 — account merge.
 *
 * The merge previously committed the canonical role change in a transaction and
 * then relinked requests, relinked the driver registry, and wrote the
 * `accountMergeEvents` audit record in SEPARATE writes AFTERWARDS, so a failure
 * between those steps could leave a committed merge with no audit record (or a
 * partial relink). The fix commits every Firestore effect of the merge —
 * canonical role change, duplicate admin revocation, invariant participation,
 * driver-registry relink, request relinks, AND the audit record — in ONE
 * transaction. The ONLY non-atomic boundary is the external Firebase Auth
 * deletion, whose outcome is written to the (already-durable) audit record by a
 * best-effort post-commit update.
 *
 * The last-admin invariant (#70) and the oversized-merge fail-closed guard are
 * proven by phantomAdmin.emulator.test.ts; the durable Auth-side convergence
 * (disable → revoke → delete, retries, lease reclamation) is proven by
 * mergeAuthReconciliation.emulator.test.ts / .auth-emulator.test.ts. These
 * tests focus on the Firestore state/audit atomicity boundary #49 introduces.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const USERS = "users";
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const MERGE_EVENTS = "accountMergeEvents";

async function clearState(): Promise<void> {
  for (const c of [
    USERS,
    REQUESTS,
    REGISTRY,
    MERGE_EVENTS,
    SYSTEM_INVARIANTS_COLLECTION,
  ]) {
    await db.recursiveDelete(db.collection(c));
  }
}

/** See the identical helper in dispatchSettingsAtomic.emulator.test.ts. */
function failNextTransactionAfterStaging(): { restore: () => void } {
  const real = db.runTransaction.bind(db);
  const spy = vi.spyOn(db, "runTransaction").mockImplementationOnce(((
    updateFn: (txn: Transaction) => Promise<unknown>,
  ) =>
    real(async (txn) => {
      await updateFn(txn);
      throw new Error("INJECTED_TXN_FAILURE");
    })) as typeof db.runTransaction);
  return { restore: () => spy.mockRestore() };
}

async function seedUser(uid: string, roles: UserRole[]): Promise<void> {
  await db
    .collection(USERS)
    .doc(uid)
    .set({
      displayName: `Name ${uid}`,
      email: `${uid}@example.test`,
      phone: null,
      roles,
      village: null,
      deliveryDirections: null,
      deliveryProfileConfirmedAt: null,
      accountOrigin: "self_registered",
      authStatus: "claimed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

async function seedRequestsOwnedBy(
  customerId: string,
  count: number,
  prefix = "req",
): Promise<void> {
  for (let start = 0; start < count; start += 400) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 400, count); i++) {
      batch.set(db.collection(REQUESTS).doc(`${prefix}-${i}`), {
        customerId,
        status: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await batch.commit();
  }
}

async function rolesOf(uid: string): Promise<UserRole[]> {
  const snap = await db.collection(USERS).doc(uid).get();
  return (snap.data()?.roles ?? []) as UserRole[];
}

async function mergeEvents() {
  const snap = await db.collection(MERGE_EVENTS).get();
  return snap.docs.map((d) => d.data());
}

async function requestOwnerCount(customerId: string): Promise<number> {
  const snap = await db
    .collection(REQUESTS)
    .where("customerId", "==", customerId)
    .count()
    .get();
  return snap.data().count;
}

beforeEach(clearState);
afterAll(clearState);

describe("mergeUserAccounts — Firestore state + audit commit atomically (#49)", () => {
  it("relinks roles, requests, and the driver registry together with the audit record", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident", "viewer"]);
    await seedRequestsOwnedBy("dup", 3);
    // Duplicate linked to a registry entry; canonical is not — so the link moves.
    await db.collection(REGISTRY).doc("reg-1").set({
      displayName: "Driver Dup",
      linkedUserId: "dup",
      eligibilityStatus: "eligible",
      availabilityStatus: "offline",
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: "seed",
    });

    const result = await mergeUserAccounts({
      canonicalUid: "canon",
      duplicateUid: "dup",
      actorId: "admin-1",
      reason: "dup",
      roleMergePolicy: "union",
    });

    // Role union (resident + viewer) applied to canonical.
    expect((await rolesOf("canon")).sort()).toEqual(["resident", "viewer"]);
    // All duplicate requests relinked to canonical.
    expect(await requestOwnerCount("dup")).toBe(0);
    expect(await requestOwnerCount("canon")).toBe(3);
    // Driver registry relinked to canonical.
    const reg = await db.collection(REGISTRY).doc("reg-1").get();
    expect(reg.data()?.linkedUserId).toBe("canon");

    // Exactly one audit record, with accurate counts committed in the same txn.
    const events = await mergeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].counts).toEqual({
      requestsRelinked: 3,
      driverRegistryRelinked: 1,
    });
    expect(result.requestsRelinked).toBe(3);
    expect(result.driverRegistryRelinked).toBe(1);

    // Auth reconciliation is the external boundary: it fails in this test
    // env, and that outcome is recorded DURABLY — the record is pending and
    // retryable, not a one-shot best effort (issue #73).
    expect(result.duplicateAuthDeleted).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.authReconciliation).toBe("pending");
    expect(events[0].duplicateAuthDeleted).toBe(false);
    expect(events[0].error).toBeTruthy();
    expect(events[0].authReconciliation?.state).toBe("pending");
    expect(events[0].authReconciliation?.attemptCount).toBe(1);
    expect(events[0].authReconciliation?.nextAttemptAt).toBeTruthy();

    // The merged-away marker was stamped inside the merge transaction —
    // the duplicate is application-rejected even while its Auth identity
    // still exists.
    const dupDoc = await db.collection(USERS).doc("dup").get();
    expect(dupDoc.data()?.mergedIntoUserId).toBe("canon");
  }, 30_000);

  it("writes NO audit record and relinks nothing when the transaction fails mid-commit", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident", "viewer"]);
    await seedRequestsOwnedBy("dup", 3);
    await db.collection(REGISTRY).doc("reg-1").set({
      displayName: "Driver Dup",
      linkedUserId: "dup",
      eligibilityStatus: "eligible",
      availabilityStatus: "offline",
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: "seed",
    });

    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        mergeUserAccounts({
          canonicalUid: "canon",
          duplicateUid: "dup",
          actorId: "admin-1",
          reason: "dup",
          roleMergePolicy: "union",
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    // Nothing committed: no misleading "success" audit, no partial relink.
    expect(await mergeEvents()).toHaveLength(0);
    expect((await rolesOf("canon")).sort()).toEqual(["resident"]);
    expect(await requestOwnerCount("dup")).toBe(3);
    expect(await requestOwnerCount("canon")).toBe(0);
    const reg = await db.collection(REGISTRY).doc("reg-1").get();
    expect(reg.data()?.linkedUserId).toBe("dup");
  }, 30_000);

  it("commits a maximum-size merge (all fixed writes + MAX relinks) within the write limit", async () => {
    // Worst case for the single-transaction write budget: canonical role
    // update + duplicate admin revocation + shared invariant doc + driver
    // registry relink + audit record (5 fixed writes) plus the maximum allowed
    // request relinks. A third admin keeps the last-admin guard satisfied.
    // If the write budget were miscalculated this transaction would exceed
    // Firestore's 500-write limit and fail.
    const MAX = 495; // = FIRESTORE_MAX_TXN_WRITES (500) - 5 fixed writes
    await seedUser("canon", ["resident", "admin"]);
    await seedUser("dup", ["resident", "admin"]);
    await seedUser("thirdAdmin", ["resident", "admin"]);
    await seedRequestsOwnedBy("dup", MAX, "big");
    await db.collection(REGISTRY).doc("reg-1").set({
      displayName: "Driver Dup",
      linkedUserId: "dup",
      eligibilityStatus: "eligible",
      availabilityStatus: "offline",
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: "seed",
    });

    const result = await mergeUserAccounts({
      canonicalUid: "canon",
      duplicateUid: "dup",
      actorId: "thirdAdmin",
      reason: "dup",
      roleMergePolicy: "union", // decommissions the duplicate admin -> reducesAdmins
    });

    expect(result.requestsRelinked).toBe(MAX);
    expect(result.driverRegistryRelinked).toBe(1);
    expect(await requestOwnerCount("dup")).toBe(0);
    expect(await requestOwnerCount("canon")).toBe(MAX);
    // Union preserves the canonical's admin role (#95); the decommissioned
    // duplicate's admin is still revoked.
    expect(await rolesOf("canon")).toContain("admin");
    expect(await rolesOf("dup")).not.toContain("admin");

    const events = await mergeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].counts).toEqual({
      requestsRelinked: MAX,
      driverRegistryRelinked: 1,
    });
    expect(events[0].duplicateAdminRevoked).toBe(true);

    // The invariant document was written inside the same transaction.
    const invariant = await db
      .collection(SYSTEM_INVARIANTS_COLLECTION)
      .doc(ADMIN_ROLE_INVARIANT_DOC)
      .get();
    expect(invariant.exists).toBe(true);
  }, 120_000);
});
