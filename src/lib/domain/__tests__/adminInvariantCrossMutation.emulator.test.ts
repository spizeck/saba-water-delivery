import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Merge calls `auth.deleteUser` (best-effort). Under `npm run test:rules` only
// the firestore + storage emulators run, so point the Auth emulator host at its
// standard (unused) port: the call fails fast with a connection error that
// merge catches — the same best-effort behavior as when Auth deletion fails in
// production — instead of hanging on credential/metadata lookups. The merge
// itself still succeeds; these tests assert the admin-invariant outcome, not
// Auth deletion.
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  ADMIN_ROLE_INVARIANT_DOC,
  countAdmins,
  removeRole,
  SYSTEM_INVARIANTS_COLLECTION,
} from "@/lib/domain/admin";
import { mergeUserAccounts } from "@/lib/domain/identity";
import type { UserRole } from "@/lib/domain/types";

/**
 * Emulator-backed CROSS-OPERATION concurrency tests for the last-admin
 * invariant (issue #70).
 *
 * #48 made concurrent `removeRole` admin removals safe via the shared
 * `systemInvariants/adminRole` singleton. #70 extends that same protocol to
 * every supported admin-reducing mutation — here, an admin-demoting
 * `mergeUserAccounts` — so the mutations serialize against EACH OTHER. These
 * tests exercise the real domain functions against the Firestore emulator (not
 * mocks) and prove no combination can leave zero admins.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const USERS = "users";
const MERGE_EVENTS = "accountMergeEvents";
const REQUESTS = "waterRequests";
const DRIVER_REGISTRY = "driverRegistry";

async function clearState(): Promise<void> {
  await db.recursiveDelete(db.collection(USERS));
  await db.recursiveDelete(db.collection(SYSTEM_INVARIANTS_COLLECTION));
  await db.recursiveDelete(db.collection(MERGE_EVENTS));
  await db.recursiveDelete(db.collection(REQUESTS));
  await db.recursiveDelete(db.collection(DRIVER_REGISTRY));
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
      accountOrigin: "self_registered",
      authStatus: "claimed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

async function rolesOf(uid: string): Promise<UserRole[]> {
  const snap = await db.collection(USERS).doc(uid).get();
  return (snap.data()?.roles ?? []) as UserRole[];
}

async function mergeEventCount(): Promise<number> {
  const snap = await db.collection(MERGE_EVENTS).get();
  return snap.size;
}

async function invariantDoc(): Promise<{
  exists: boolean;
  adminCount?: number;
} | null> {
  const snap = await db
    .collection(SYSTEM_INVARIANTS_COLLECTION)
    .doc(ADMIN_ROLE_INVARIANT_DOC)
    .get();
  return { exists: snap.exists, adminCount: snap.data()?.adminCount };
}

type Settled = { ok: true } | { ok: false; code: string };

function settle(p: Promise<unknown>): Promise<Settled> {
  return p.then(
    () => ({ ok: true }) as Settled,
    (err) =>
      ({
        ok: false,
        code: err instanceof Error ? err.message : "UNKNOWN",
      }) as Settled,
  );
}

/** A union merge of a non-admin canonical with an admin duplicate is
 *  admin-reducing: the duplicate is decommissioned (its Auth identity is
 *  deleted) and its admin role is revoked — union preserves canonical roles
 *  but never transfers a privileged duplicate role (#95). */
function unionMerge(
  canonicalUid: string,
  duplicateUid: string,
  actorId: string,
) {
  return mergeUserAccounts({
    canonicalUid,
    duplicateUid,
    actorId,
    reason: "dup",
    roleMergePolicy: "union",
  });
}

beforeEach(async () => {
  await clearState();
});

afterAll(async () => {
  await clearState();
});

describe("last-admin invariant across admin-reducing mutations (#70)", () => {
  it("removeRole vs admin-demoting merge cannot both succeed (2 admins)", async () => {
    await seedUser("adminA", ["resident", "admin"]);
    await seedUser("adminB", ["resident", "admin"]);
    await seedUser("canonR", ["resident"]);
    expect(await countAdmins()).toBe(2);

    // removeRole strips admin from A; the union merge decommissions admin B
    // (the duplicate). If both commit, zero admins remain.
    const [rRemove, rMerge] = await Promise.all([
      settle(
        removeRole({ targetUid: "adminA", role: "admin", actorId: "adminB" }),
      ),
      settle(unionMerge("canonR", "adminB", "adminA")),
    ]);

    const successes = [rRemove, rMerge].filter((r) => r.ok);
    const failures = [rRemove, rMerge].filter((r) => !r.ok) as {
      ok: false;
      code: string;
    }[];

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe("LAST_ADMIN");

    const remaining = await countAdmins();
    expect(remaining).toBe(1);
    // Invariant metadata stays consistent with the live source of truth.
    expect((await invariantDoc())?.adminCount).toBe(remaining);
  }, 30_000);

  it("two admin-demoting merges cannot both succeed (2 admins)", async () => {
    await seedUser("adminA", ["resident", "admin"]);
    await seedUser("adminB", ["resident", "admin"]);
    await seedUser("canonRA", ["resident"]);
    await seedUser("canonRB", ["resident"]);
    expect(await countAdmins()).toBe(2);

    // Each merge decommissions one of the two admins (the duplicate).
    const [m1, m2] = await Promise.all([
      settle(unionMerge("canonRA", "adminA", "adminB")),
      settle(unionMerge("canonRB", "adminB", "adminA")),
    ]);

    const successes = [m1, m2].filter((r) => r.ok);
    const failures = [m1, m2].filter((r) => !r.ok) as {
      ok: false;
      code: string;
    }[];

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe("LAST_ADMIN");
    expect(await countAdmins()).toBe(1);
  }, 30_000);

  it("rejects a merge that would decommission the sole remaining admin", async () => {
    await seedUser("solo", ["resident", "admin"]);
    await seedUser("canon", ["resident"]);
    expect(await countAdmins()).toBe(1);

    // The sole admin is the duplicate: decommissioning it leaves zero usable
    // admins, and union will not transfer its admin role (#95).
    await expect(unionMerge("canon", "solo", "canon")).rejects.toThrow(
      "LAST_ADMIN",
    );

    // Fail closed: no partial state, no misleading success audit event.
    expect(await countAdmins()).toBe(1);
    expect(await rolesOf("solo")).toContain("admin");
    expect(await mergeEventCount()).toBe(0);
    // The invariant document was not written on the rejected path.
    expect((await invariantDoc())?.exists).toBe(false);
  });

  it("allows an admin-decommissioning merge while another admin remains", async () => {
    await seedUser("adminA", ["resident", "admin"]);
    await seedUser("adminB", ["resident", "admin"]);
    await seedUser("canon", ["resident"]);
    expect(await countAdmins()).toBe(2);

    const result = await unionMerge("canon", "adminA", "adminB");
    expect(result.canonicalUser.uid).toBe("canon");

    // adminA decommissioned (admin revoked), adminB still admin; the
    // canonical gained no privileged role.
    expect(await rolesOf("adminA")).not.toContain("admin");
    expect(await rolesOf("adminB")).toContain("admin");
    expect(await rolesOf("canon")).toEqual(["resident"]);
    const remaining = await countAdmins();
    expect(remaining).toBe(1);
    expect(await mergeEventCount()).toBe(1);
    // Invariant metadata is self-healing: equals the live count.
    expect((await invariantDoc())?.adminCount).toBe(remaining);
  });

  it("leaves a non-admin merge's behavior unchanged and untouched by the invariant", async () => {
    await seedUser("adminOnly", ["resident", "admin"]); // an unrelated admin
    await seedUser("canon", ["resident"]);
    await seedUser("dup", ["resident", "viewer"]);

    const result = await unionMerge("canon", "dup", "adminOnly");
    expect(result.canonicalUser.uid).toBe("canon");

    // Union carries the non-sensitive viewer role onto the canonical.
    expect((await rolesOf("canon")).sort()).toEqual(["resident", "viewer"]);
    expect(await mergeEventCount()).toBe(1);
    // A non-admin-reducing merge never creates/touches the invariant document.
    expect((await invariantDoc())?.exists).toBe(false);
    // The unrelated admin is untouched.
    expect(await rolesOf("adminOnly")).toContain("admin");
    expect(await countAdmins()).toBe(1);
  });

  it("keeps an explicit merge that retains admin off the invariant path", async () => {
    await seedUser("adminA", ["resident", "admin"]);
    await seedUser("dup", ["resident"]);
    expect(await countAdmins()).toBe(1);

    // Explicit policy that keeps admin is NOT admin-reducing, so it must
    // succeed even with a single admin and must not touch the invariant doc.
    const result = await mergeUserAccounts({
      canonicalUid: "adminA",
      duplicateUid: "dup",
      actorId: "adminA",
      reason: "dup",
      roleMergePolicy: "explicit",
      explicitRoles: ["resident", "admin"],
    });
    expect(result.canonicalUser.uid).toBe("adminA");

    expect(await rolesOf("adminA")).toContain("admin");
    expect(await countAdmins()).toBe(1);
    expect((await invariantDoc())?.exists).toBe(false);
    expect(await mergeEventCount()).toBe(1);
  });
});
