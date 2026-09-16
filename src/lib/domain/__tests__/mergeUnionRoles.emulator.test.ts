import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only firestore + storage emulators run under `npm run test:rules`; point the
// Auth emulator host at its standard (unused) port so the merge's immediate
// Auth reconciliation fails fast with a connection error — the same behavior
// as a production Auth outage. The merge's Firestore effects (the subject of
// these tests) are unaffected. See mergeAtomicAudit.emulator.test.ts.
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { countAdmins } from "@/lib/domain/admin";
import {
  getAccountMergePreview,
  mergeUserAccounts,
} from "@/lib/domain/identity";
import type { UserRole } from "@/lib/domain/types";

/**
 * Emulator-backed regression tests for issue #95 — union-mode account merges
 * stripped privileged roles from the CANONICAL user.
 *
 * Confirmed pilot incident (2026-09-11): canonical roles
 * [resident, driver, dispatcher, admin] + duplicate [resident] merged with
 * `roleMergePolicy: "union"` left the canonical user with only ["resident"].
 * Root cause: the committed role list was `safeRoles(canonical ∪ duplicate)`
 * computed from the non-transactional preview — a non-sensitive union used as
 * the complete replacement role list. Correct semantics:
 *
 *   finalRoles = canonicalRoles ∪ (duplicateRoles ∩ {resident, viewer})
 *
 * recomputed from the fresh documents inside the merge transaction. Union can
 * neither revoke a canonical role nor transfer a privileged duplicate role
 * (admin, dispatcher, driver); those require explicit mode.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const USERS = "users";
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const MERGE_EVENTS = "accountMergeEvents";

async function clearState(): Promise<void> {
  for (const c of [USERS, REQUESTS, REGISTRY, MERGE_EVENTS]) {
    await db.recursiveDelete(db.collection(c));
  }
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

async function seedRegistryEntry(
  registryId: string,
  linkedUserId: string,
): Promise<void> {
  await db
    .collection(REGISTRY)
    .doc(registryId)
    .set({
      displayName: `Driver ${registryId}`,
      linkedUserId,
      eligibilityStatus: "eligible",
      availabilityStatus: "offline",
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: "seed",
    });
}

async function rolesOf(uid: string): Promise<UserRole[]> {
  const snap = await db.collection(USERS).doc(uid).get();
  return (snap.data()?.roles ?? []) as UserRole[];
}

async function mergeEvents() {
  const snap = await db.collection(MERGE_EVENTS).get();
  return snap.docs.map((d) => d.data());
}

function unionMerge(
  canonicalUid: string,
  duplicateUid: string,
  actorId = "actor-1",
) {
  return mergeUserAccounts({
    canonicalUid,
    duplicateUid,
    actorId,
    reason: "dup",
    roleMergePolicy: "union",
  });
}

/**
 * Mutates `users/{uid}` between `mergeUserAccounts`' internal preview read and
 * the start of its Firestore transaction — proving the committed role list is
 * recomputed from fresh transaction reads, not the pre-transaction preview.
 */
function mutateUserBeforeNextTransaction(
  uid: string,
  roles: UserRole[],
): { restore: () => void } {
  const real = db.runTransaction.bind(db);
  const spy = vi.spyOn(db, "runTransaction").mockImplementationOnce(((
    updateFn: (txn: Transaction) => Promise<unknown>,
  ) => {
    return (async () => {
      await db.collection(USERS).doc(uid).update({ roles });
      return real(updateFn);
    })();
  }) as typeof db.runTransaction);
  return { restore: () => spy.mockRestore() };
}

beforeEach(clearState);
afterAll(clearState);

describe("union merge role semantics (#95)", () => {
  it("confirmed incident: canonical keeps all privileged roles merged with a resident duplicate", async () => {
    await seedUser("canon", ["resident", "driver", "dispatcher", "admin"]);
    await seedUser("dup", ["resident"]);

    await unionMerge("canon", "dup");

    expect((await rolesOf("canon")).sort()).toEqual([
      "admin",
      "dispatcher",
      "driver",
      "resident",
    ]);
    const events = await mergeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].roleMergePolicy).toBe("union");
    // Audit records the roles actually committed, not the old filtered union.
    expect(events[0].mergedRoles).toEqual([
      "admin",
      "dispatcher",
      "driver",
      "resident",
    ]);
    // Canonical kept admin, duplicate never had it: no admin population
    // change at all.
    expect(events[0].duplicateAdminRevoked).toBe(false);
    expect(await countAdmins()).toBe(1);
  }, 30_000);

  it("inverse: privileged duplicate roles never leak onto the canonical account", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident", "driver", "dispatcher", "admin"]);
    await seedUser("thirdAdmin", ["resident", "admin"]); // keeps a usable admin

    await unionMerge("canon", "dup", "thirdAdmin");

    expect(await rolesOf("canon")).toEqual(["resident"]);
    // The decommissioned duplicate's admin is revoked (phantom-admin
    // prevention); its other roles remain for historical linkage.
    expect((await rolesOf("dup")).sort()).toEqual([
      "dispatcher",
      "driver",
      "resident",
    ]);
    const events = await mergeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].mergedRoles).toEqual(["resident"]);
    expect(events[0].duplicateAdminRevoked).toBe(true);
    expect(await countAdmins()).toBe(1);
  }, 30_000);

  it("rejects a union merge whose duplicate is the last usable admin (LAST_ADMIN)", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dupSoloAdmin", ["resident", "admin"]);
    expect(await countAdmins()).toBe(1);

    await expect(unionMerge("canon", "dupSoloAdmin")).rejects.toThrow(
      "LAST_ADMIN",
    );

    // Fail closed: nothing committed.
    expect(await rolesOf("canon")).toEqual(["resident"]);
    expect(await rolesOf("dupSoloAdmin")).toContain("admin");
    expect(await countAdmins()).toBe(1);
    expect(await mergeEvents()).toHaveLength(0);
  }, 30_000);

  it("preserves a canonical driver role and its registry link; does not grant driver from the duplicate", async () => {
    // Canonical driver + registry link survives a union merge.
    await seedUser("canonDriver", ["resident", "driver"]);
    await seedUser("dupResident", ["resident"]);
    await seedRegistryEntry("reg-canon", "canonDriver");

    await unionMerge("canonDriver", "dupResident");

    expect((await rolesOf("canonDriver")).sort()).toEqual([
      "driver",
      "resident",
    ]);
    const regCanon = await db.collection(REGISTRY).doc("reg-canon").get();
    expect(regCanon.data()?.linkedUserId).toBe("canonDriver");
  }, 30_000);

  it("relinks the duplicate's registry entry without granting the driver role", async () => {
    // Duplicate holds driver + a registry link; canonical does not. Union
    // moves the registry link (existing behavior) but must NOT grant the
    // driver role — privileged roles require explicit mode.
    await seedUser("canon", ["resident"]);
    await seedUser("dupDriver", ["resident", "driver"]);
    await seedRegistryEntry("reg-dup", "dupDriver");

    const result = await unionMerge("canon", "dupDriver");

    expect(result.driverRegistryRelinked).toBe(1);
    expect(await rolesOf("canon")).toEqual(["resident"]);
    const regDup = await db.collection(REGISTRY).doc("reg-dup").get();
    expect(regDup.data()?.linkedUserId).toBe("canon");
  }, 30_000);

  it("preserves a canonical role gained between preview and the merge transaction (TOCTOU)", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident"]);

    // Canonical gains a privileged role AFTER mergeUserAccounts' preview but
    // BEFORE the transaction's reads. The committed result must honor the
    // live role, not the stale preview union.
    const inject = mutateUserBeforeNextTransaction("canon", [
      "resident",
      "dispatcher",
    ]);
    try {
      await unionMerge("canon", "dup");
    } finally {
      inject.restore();
    }

    expect((await rolesOf("canon")).sort()).toEqual(["dispatcher", "resident"]);
    const events = await mergeEvents();
    expect(events[0].mergedRoles).toEqual(["dispatcher", "resident"]);
  }, 30_000);

  it("imports a duplicate role gained between preview and the merge transaction (TOCTOU)", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident"]);

    // Duplicate gains viewer after the preview; the transaction reads live
    // state, so the safe role is still imported.
    const inject = mutateUserBeforeNextTransaction("dup", [
      "resident",
      "viewer",
    ]);
    try {
      await unionMerge("canon", "dup");
    } finally {
      inject.restore();
    }

    expect((await rolesOf("canon")).sort()).toEqual(["resident", "viewer"]);
    const events = await mergeEvents();
    expect(events[0].mergedRoles).toEqual(["resident", "viewer"]);
  }, 30_000);

  it("never leaks a privileged role the duplicate gained between preview and the merge transaction (TOCTOU)", async () => {
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident"]);
    await seedUser("thirdAdmin", ["resident", "admin"]); // keeps a usable admin

    // Duplicate gains admin after the preview but before the transaction's
    // reads. Union must still not transfer it — and the decommissioned
    // duplicate's admin is revoked (phantom-admin prevention).
    const inject = mutateUserBeforeNextTransaction("dup", [
      "resident",
      "admin",
    ]);
    try {
      await unionMerge("canon", "dup", "thirdAdmin");
    } finally {
      inject.restore();
    }

    expect(await rolesOf("canon")).toEqual(["resident"]);
    expect(await rolesOf("dup")).toEqual(["resident"]);
    const events = await mergeEvents();
    expect(events[0].mergedRoles).toEqual(["resident"]);
    expect(events[0].duplicateAdminRevoked).toBe(true);
    expect(await countAdmins()).toBe(1);
  }, 30_000);

  it("preview shows the exact union result for the incident shape", async () => {
    await seedUser("canon", ["resident", "driver", "dispatcher", "admin"]);
    await seedUser("dup", ["resident"]);

    const preview = await getAccountMergePreview("canon", "dup");

    expect(preview.unionResultRoles).toEqual([
      "admin",
      "dispatcher",
      "driver",
      "resident",
    ]);
  }, 30_000);

  it("explicit mode still replaces roles deliberately, subject to last-admin", async () => {
    await seedUser("canon", ["resident", "admin"]);
    await seedUser("dup", ["resident"]);
    await seedUser("thirdAdmin", ["resident", "admin"]);

    const result = await mergeUserAccounts({
      canonicalUid: "canon",
      duplicateUid: "dup",
      actorId: "thirdAdmin",
      reason: "dup",
      roleMergePolicy: "explicit",
      explicitRoles: ["resident"],
    });

    expect(result.canonicalUser.uid).toBe("canon");
    // Deliberate demotion committed — explicit mode remains the only way to
    // remove a canonical role.
    expect(await rolesOf("canon")).toEqual(["resident"]);
    const events = await mergeEvents();
    expect(events[0].mergedRoles).toEqual(["resident"]);
    expect(await countAdmins()).toBe(1);
  }, 30_000);
});
