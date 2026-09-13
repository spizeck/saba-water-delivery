import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Merge calls `auth.deleteUser` (best-effort). Under `npm run test:rules` only
// firestore + storage emulators run, so point the Auth emulator host at its
// standard (unused) port: the call fails fast with a connection error that
// merge catches — the same best-effort behavior as a production Auth-deletion
// failure. The merge's Firestore effects (the subject of these tests) are
// unaffected. Note: because Auth deletion "fails" here the duplicate is not
// truly removed from Auth, which makes these tests CONSERVATIVE — the
// phantom-admin risk is strictly worse when Auth deletion succeeds.
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
 * Emulator-backed regression tests for the "phantom admin" gap in the #70
 * last-admin invariant.
 *
 * `mergeUserAccounts` deletes the duplicate's Firebase Auth identity but leaves
 * its `users/{uid}` document. Before the fix, a duplicate that carried `admin`
 * kept being counted by `countAdmins()` even though it could no longer sign in,
 * so a merge could leave zero *usable* administrators while appearing to leave
 * one. The fix revokes `admin` from the decommissioned duplicate inside the
 * shared invariant protocol and counts that revocation in the last-admin check.
 *
 * Effective/usable administrator (post-fix): a `users` document that holds the
 * `admin` role AND whose login identity has NOT been decommissioned by a merge.
 * `countAdmins()` stays role-based; the merge keeps it aligned with usability by
 * revoking `admin` from the account whose identity it destroys.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const USERS = "users";
const MERGE_EVENTS = "accountMergeEvents";

async function clearState(): Promise<void> {
  for (const c of [
    USERS,
    SYSTEM_INVARIANTS_COLLECTION,
    MERGE_EVENTS,
    "waterRequests",
    "driverRegistry",
  ]) {
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

async function rolesOf(uid: string): Promise<UserRole[]> {
  const snap = await db.collection(USERS).doc(uid).get();
  return (snap.data()?.roles ?? []) as UserRole[];
}

async function userDoc(uid: string) {
  return db.collection(USERS).doc(uid).get();
}

async function mergeEventCount(): Promise<number> {
  const snap = await db.collection(MERGE_EVENTS).get();
  return snap.size;
}

async function invariantExists(): Promise<boolean> {
  const snap = await db
    .collection(SYSTEM_INVARIANTS_COLLECTION)
    .doc(ADMIN_ROLE_INVARIANT_DOC)
    .get();
  return snap.exists;
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

beforeEach(clearState);
afterAll(clearState);

describe("phantom admin — merge cannot leave zero usable admins", () => {
  it("rejects a merge that would leave only the decommissioned duplicate as admin", async () => {
    // Exactly two usable admins. A union merge demotes the canonical AND
    // decommissions the duplicate admin — that is zero usable admins, so it
    // must be refused (previously it succeeded, leaving a phantom).
    await seedUser("canonAdmin", ["resident", "admin"]);
    await seedUser("dupAdmin", ["resident", "admin"]);
    expect(await countAdmins()).toBe(2);

    await expect(
      unionMerge("canonAdmin", "dupAdmin", "canonAdmin"),
    ).rejects.toThrow("LAST_ADMIN");

    // Fail closed: nothing changed, no audit record, invariant doc untouched.
    expect(await rolesOf("canonAdmin")).toContain("admin");
    expect(await rolesOf("dupAdmin")).toContain("admin");
    expect(await countAdmins()).toBe(2);
    expect(await mergeEventCount()).toBe(0);
    expect(await invariantExists()).toBe(false);
  }, 30_000);

  it("revokes the decommissioned duplicate's admin (no phantom) when another usable admin remains", async () => {
    await seedUser("canonAdmin", ["resident", "admin"]);
    await seedUser("dupAdmin", ["resident", "viewer", "admin"]);
    await seedUser("thirdAdmin", ["resident", "admin"]); // keeps a usable admin
    expect(await countAdmins()).toBe(3);

    const result = await unionMerge("canonAdmin", "dupAdmin", "thirdAdmin");
    expect(result.canonicalUser.uid).toBe("canonAdmin");

    // Canonical demoted (union drops admin); duplicate's admin REVOKED.
    expect(await rolesOf("canonAdmin")).not.toContain("admin");
    expect(await rolesOf("dupAdmin")).not.toContain("admin");
    // Only the untouched third admin remains — and it is a usable identity.
    expect(await countAdmins()).toBe(1);
    expect(await rolesOf("thirdAdmin")).toContain("admin");

    // Historical duplicate record is preserved (doc + non-admin roles + fields).
    const dup = await userDoc("dupAdmin");
    expect(dup.exists).toBe(true);
    expect(dup.data()?.displayName).toBe("Name dupAdmin");
    expect((await rolesOf("dupAdmin")).sort()).toEqual(["resident", "viewer"]);

    // Audit records the merge and the admin revocation.
    expect(await mergeEventCount()).toBe(1);
    const event = (await db.collection(MERGE_EVENTS).get()).docs[0].data();
    expect(event.duplicateAdminRevoked).toBe(true);
  }, 30_000);

  it("transfers admin from duplicate to canonical without leaving a phantom", async () => {
    // Canonical is not an admin; explicit merge moves admin onto it while the
    // duplicate is decommissioned. Net usable admins stays the same; no phantom.
    await seedUser("canon", ["resident"]);
    await seedUser("dupAdmin", ["resident", "admin"]);
    expect(await countAdmins()).toBe(1);

    const result = await mergeUserAccounts({
      canonicalUid: "canon",
      duplicateUid: "dupAdmin",
      actorId: "dupAdmin",
      reason: "dup",
      roleMergePolicy: "explicit",
      explicitRoles: ["resident", "admin"],
    });
    expect(result.canonicalUser.uid).toBe("canon");

    expect(await rolesOf("canon")).toContain("admin"); // gained admin
    expect(await rolesOf("dupAdmin")).not.toContain("admin"); // revoked
    expect(await countAdmins()).toBe(1); // moved, not duplicated
  }, 30_000);

  it("serializes removeRole against a duplicate-decommissioning merge (2 admins)", async () => {
    // Two usable admins A and B, plus a resident R that will absorb B.
    await seedUser("adminA", ["resident", "admin"]);
    await seedUser("adminB", ["resident", "admin"]);
    await seedUser("canonR", ["resident"]);
    expect(await countAdmins()).toBe(2);

    // Op1 removes A. Op2 merges admin B into resident R, decommissioning B
    // (explicit roles without admin). Each removes one of the two admins; if
    // both commit, zero usable admins remain.
    const [rRemove, rMerge] = await Promise.all([
      settle(
        removeRole({ targetUid: "adminA", role: "admin", actorId: "adminB" }),
      ),
      settle(
        mergeUserAccounts({
          canonicalUid: "canonR",
          duplicateUid: "adminB",
          actorId: "adminA",
          reason: "dup",
          roleMergePolicy: "explicit",
          explicitRoles: ["resident"],
        }),
      ),
    ]);

    const successes = [rRemove, rMerge].filter((r) => r.ok);
    const failures = [rRemove, rMerge].filter((r) => !r.ok) as {
      ok: false;
      code: string;
    }[];

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe("LAST_ADMIN");
    // Exactly one usable admin remains.
    expect(await countAdmins()).toBe(1);
  }, 30_000);

  it("fails closed (no partial state) when the duplicate owns too many requests to relink atomically", async () => {
    // Guard against the one partial-merge window the role-first transaction
    // introduced: if the request-relink batch would exceed Firestore's 500-write
    // limit, the merge must reject BEFORE any write rather than after committing
    // the role change. Seed 501 duplicate-owned requests.
    await seedUser("canonAdmin", ["resident", "admin"]);
    await seedUser("dupAdmin", ["resident", "admin"]);

    const total = 501;
    for (let start = 0; start < total; start += 400) {
      const batch = db.batch();
      for (let i = start; i < Math.min(start + 400, total); i++) {
        batch.set(db.collection("waterRequests").doc(`req-${i}`), {
          customerId: "dupAdmin",
          status: "available",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      await batch.commit();
    }

    await expect(
      unionMerge("canonAdmin", "dupAdmin", "canonAdmin"),
    ).rejects.toThrow("MERGE_TOO_MANY_REQUESTS");

    // Nothing changed: roles intact, no audit, no invariant doc, requests still
    // owned by the duplicate.
    expect(await rolesOf("canonAdmin")).toContain("admin");
    expect(await rolesOf("dupAdmin")).toContain("admin");
    expect(await countAdmins()).toBe(2);
    expect(await mergeEventCount()).toBe(0);
    expect(await invariantExists()).toBe(false);
    const stillDup = await db
      .collection("waterRequests")
      .where("customerId", "==", "dupAdmin")
      .count()
      .get();
    expect(stillDup.data().count).toBe(total);
  }, 60_000);
});
