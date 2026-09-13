import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminDb } from "@/lib/firebase/admin";
import {
  addRole,
  ADMIN_ROLE_INVARIANT_DOC,
  countAdmins,
  removeRole,
  SYSTEM_INVARIANTS_COLLECTION,
} from "@/lib/domain/admin";
import type { UserRole } from "@/lib/domain/types";

/**
 * Emulator-backed concurrency tests for the last-admin role-removal invariant
 * (issue #48).
 *
 * Runs only under `npm run test:rules` (`firebase emulators:exec` sets
 * FIRESTORE_EMULATOR_HOST, so the Admin SDK talks to the emulator with just a
 * projectId — no real credentials). It is excluded from the plain `vitest`
 * run, which has no emulator.
 *
 * The key scenario fires two authorized admin removals that target DIFFERENT
 * admins at the same time, starting from exactly two admins. The invariant —
 * "the system must never remove the last admin" — must hold: at most one
 * removal may succeed and at least one admin must remain. This proves the
 * real Firestore transaction contention/serialization, not a mock.
 */

const db = getAdminDb();
const USERS = "users";

async function clearState(): Promise<void> {
  // recursiveDelete removes each user document AND its roleEvents subcollection
  // so audit assertions never see a previous test's events.
  await db.recursiveDelete(db.collection(USERS));
  await db.recursiveDelete(db.collection(SYSTEM_INVARIANTS_COLLECTION));
}

async function seedUser(uid: string, roles: UserRole[]): Promise<void> {
  await db
    .collection(USERS)
    .doc(uid)
    .set({
      displayName: uid,
      email: `${uid}@example.test`,
      phone: null,
      roles,
      village: null,
      deliveryDirections: null,
      deliveryProfileConfirmedAt: null,
      accountOrigin: "staff_registered",
      authStatus: "claimed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

async function rolesOf(uid: string): Promise<UserRole[]> {
  const snap = await db.collection(USERS).doc(uid).get();
  return (snap.data()?.roles ?? []) as UserRole[];
}

async function roleRemovedEvents(uid: string): Promise<number> {
  const snap = await db
    .collection(USERS)
    .doc(uid)
    .collection("roleEvents")
    .where("type", "==", "role_removed")
    .get();
  return snap.size;
}

/** Settle a removal into a discriminated result for concurrency assertions. */
async function attemptRemove(
  targetUid: string,
  role: UserRole,
  actorId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await removeRole({ targetUid, role, actorId });
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err instanceof Error ? err.message : "UNKNOWN" };
  }
}

beforeEach(async () => {
  await clearState();
});

afterAll(async () => {
  await clearState();
});

describe("last-admin removal concurrency (#48)", () => {
  it("never leaves zero admins when two removals of different admins race", async () => {
    // Exactly two admins. Each removal is authorized by the OTHER admin, so
    // neither trips the self-removal guard; both observe two admins at the
    // start. If the invariant is not serialized, both commit and the system
    // is left with zero admins.
    await seedUser("adminX", ["resident", "admin"]);
    await seedUser("adminY", ["resident", "admin"]);
    expect(await countAdmins()).toBe(2);

    const [resX, resY] = await Promise.all([
      attemptRemove("adminX", "admin", "adminY"),
      attemptRemove("adminY", "admin", "adminX"),
    ]);

    const successes = [resX, resY].filter((r) => r.ok);
    const failures = [resX, resY].filter((r) => !r.ok) as {
      ok: false;
      code: string;
    }[];

    // At most one removal succeeds; at least one admin remains.
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    // The losing operation fails clearly with the existing conflict error.
    expect(failures[0].code).toBe("LAST_ADMIN");

    const remaining = await countAdmins();
    expect(remaining).toBe(1);

    // The losing operation left no partial write and no misleading audit event.
    const xRemoved = !(await rolesOf("adminX")).includes("admin");
    const yRemoved = !(await rolesOf("adminY")).includes("admin");
    expect(xRemoved !== yRemoved).toBe(true); // exactly one demoted
    // role_removed events across both users total exactly one (the winner).
    expect(
      (await roleRemovedEvents("adminX")) + (await roleRemovedEvents("adminY")),
    ).toBe(1);
  }, 30_000);

  it("allows a normal removal when three or more admins exist", async () => {
    await seedUser("a1", ["resident", "admin"]);
    await seedUser("a2", ["resident", "admin"]);
    await seedUser("a3", ["resident", "admin"]);

    await expect(
      removeRole({ targetUid: "a3", role: "admin", actorId: "a1" }),
    ).resolves.toMatchObject({ uid: "a3" });

    expect(await countAdmins()).toBe(2);
    expect(await rolesOf("a3")).not.toContain("admin");
    expect(await roleRemovedEvents("a3")).toBe(1);
  });

  it("refuses to remove the sole remaining admin (lazy sentinel init)", async () => {
    // No sentinel document exists yet — the guard must initialize safely from
    // the authoritative admin count and still refuse.
    await seedUser("solo", ["resident", "admin"]);
    await seedUser("actor", ["resident", "admin"]); // a second admin acts

    // First demote 'actor' down to one admin via a legitimate 3rd admin? No —
    // here we directly assert the single-admin case: only 'solo' is admin.
    await db
      .collection(USERS)
      .doc("actor")
      .set({ roles: ["resident"] }, { merge: true });
    expect(await countAdmins()).toBe(1);

    await expect(
      removeRole({ targetUid: "solo", role: "admin", actorId: "actor" }),
    ).rejects.toThrow("LAST_ADMIN");

    expect(await countAdmins()).toBe(1);
    expect(await rolesOf("solo")).toContain("admin");
    expect(await roleRemovedEvents("solo")).toBe(0);
  });

  it("keeps the self-admin-removal guard intact", async () => {
    await seedUser("self", ["resident", "admin"]);
    await seedUser("other", ["resident", "admin"]);

    await expect(
      removeRole({ targetUid: "self", role: "admin", actorId: "self" }),
    ).rejects.toThrow("CANNOT_REMOVE_OWN_ADMIN");

    expect(await countAdmins()).toBe(2);
    expect(await rolesOf("self")).toContain("admin");
    expect(await roleRemovedEvents("self")).toBe(0);
  });

  it("removes a non-admin role without touching the admin invariant", async () => {
    // A single admin exists; removing an unrelated (dispatcher) role from a
    // different user must succeed and must not be gated by the last-admin check.
    await seedUser("onlyAdmin", ["resident", "admin"]);
    await seedUser("staff", ["resident", "dispatcher"]);
    expect(await countAdmins()).toBe(1);

    await expect(
      removeRole({
        targetUid: "staff",
        role: "dispatcher",
        actorId: "onlyAdmin",
      }),
    ).resolves.toMatchObject({ uid: "staff" });

    expect(await rolesOf("staff")).toEqual(["resident"]);
    expect(await roleRemovedEvents("staff")).toBe(1);
    // The admin invariant document is never created by a non-admin removal.
    const sentinel = await db
      .collection(SYSTEM_INVARIANTS_COLLECTION)
      .doc(ADMIN_ROLE_INVARIANT_DOC)
      .get();
    expect(sentinel.exists).toBe(false);
    expect(await countAdmins()).toBe(1);
  });

  it("maintains the invariant across sequential removals with addRole in the mix", async () => {
    await seedUser("m1", ["resident", "admin"]);
    await seedUser("m2", ["resident", "admin"]);
    await seedUser("m3", ["resident"]);

    // Promote m3, then demote m1 — count stays >= 1 throughout.
    await addRole({ targetUid: "m3", role: "admin", actorId: "m1" });
    expect(await countAdmins()).toBe(3);

    await removeRole({ targetUid: "m1", role: "admin", actorId: "m2" });
    await removeRole({ targetUid: "m2", role: "admin", actorId: "m3" });
    expect(await countAdmins()).toBe(1);

    // m3 is now the sole admin and cannot be removed.
    await expect(
      removeRole({ targetUid: "m3", role: "admin", actorId: "m1" }),
    ).rejects.toThrow("LAST_ADMIN");
    expect(await countAdmins()).toBe(1);
  }, 30_000);
});
