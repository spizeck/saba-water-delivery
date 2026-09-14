import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminDb } from "@/lib/firebase/admin";
import {
  confirmDeliveryProfile,
  ensureUserProfile,
  getUserProfile,
  updateUserProfile,
} from "@/lib/domain/users";

/**
 * Emulator-backed tests for the first-login provisioning path behind
 * `/api/auth/session` and the resident delivery-profile lifecycle.
 *
 * `ensureUserProfile` is the ONLY place roles are assigned to a brand-new
 * account, so its invariants are production-critical: a first login must
 * always produce roles ["resident"], re-authenticating must never reset an
 * existing profile, and concurrent first-time logins must not clobber one
 * another (the reason the implementation uses `create` + a retry read).
 *
 * `updateUserProfile` owns the rule that editing delivery-relevant fields
 * IS an active review — `deliveryProfileConfirmedAt` refreshes exactly when
 * phone/village/deliveryDirections change. `confirmDeliveryProfile` owns
 * the server-side refusal to confirm an incomplete profile.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const USERS = "users";

async function clearState(): Promise<void> {
  await db.recursiveDelete(db.collection(USERS));
}

async function seedUser(uid: string, data: Record<string, unknown> = {}) {
  const now = new Date();
  await db
    .collection(USERS)
    .doc(uid)
    .set({
      displayName: "Seeded User",
      email: `${uid}@example.com`,
      phone: "+599 416 0000",
      roles: ["resident"],
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
      deliveryProfileConfirmedAt: null,
      accountOrigin: "self_registered",
      authStatus: "claimed",
      createdAt: now,
      updatedAt: now,
      ...data,
    });
}

beforeEach(clearState);
afterAll(clearState);

describe("ensureUserProfile — first-login provisioning", () => {
  it("creates a resident-only profile for a brand-new account", async () => {
    const result = await ensureUserProfile({
      uid: "uid-new",
      displayName: "New Person",
      email: "new@example.com",
      phone: null,
    });

    expect(result.created).toBe(true);
    expect(result.profile.roles).toEqual(["resident"]);
    expect(result.profile.accountOrigin).toBe("self_registered");
    expect(result.profile.authStatus).toBe("claimed");

    const stored = (await db.collection(USERS).doc("uid-new").get()).data()!;
    expect(stored.roles).toEqual(["resident"]);
  }, 30_000);

  it("returns an existing profile unchanged and never resets roles", async () => {
    await seedUser("uid-existing", { roles: ["dispatcher", "admin"] });

    const result = await ensureUserProfile({
      uid: "uid-existing",
      displayName: "Different Name",
      email: "other@example.com",
      phone: "+599 416 9999",
    });

    expect(result.created).toBe(false);
    expect(result.profile.roles).toEqual(["dispatcher", "admin"]);

    const stored = (
      await db.collection(USERS).doc("uid-existing").get()
    ).data()!;
    // A re-login must not overwrite stored profile data.
    expect(stored.displayName).toBe("Seeded User");
    expect(stored.phone).toBe("+599 416 0000");
  }, 30_000);

  it("survives concurrent first-time logins without clobbering the profile", async () => {
    const [a, b] = await Promise.all([
      ensureUserProfile({
        uid: "uid-race",
        displayName: "First Login",
        email: "a@example.com",
        phone: null,
      }),
      ensureUserProfile({
        uid: "uid-race",
        displayName: "Second Login",
        email: "b@example.com",
        phone: null,
      }),
    ]);

    // Both calls succeed; exactly one reports having created the profile.
    expect([a.created, b.created].sort()).toEqual([false, true]);

    // Exactly one document exists with one coherent set of fields.
    const stored = (await db.collection(USERS).doc("uid-race").get()).data()!;
    expect(["First Login", "Second Login"]).toContain(stored.displayName);
    expect(stored.roles).toEqual(["resident"]);
  }, 30_000);
});

describe("updateUserProfile — delivery confirmation refresh", () => {
  it("refreshes deliveryProfileConfirmedAt when a delivery field changes", async () => {
    await seedUser("uid-1");

    const updated = await updateUserProfile({
      uid: "uid-1",
      displayName: "Seeded User",
      phone: "+599 416 1111", // changed
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
    });

    expect(updated.deliveryProfileConfirmedAt).not.toBeNull();
  }, 30_000);

  it("does NOT refresh deliveryProfileConfirmedAt when only the name changes", async () => {
    await seedUser("uid-1", {
      deliveryProfileConfirmedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const updated = await updateUserProfile({
      uid: "uid-1",
      displayName: "Renamed User",
      phone: "+599 416 0000",
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
    });

    expect(updated.deliveryProfileConfirmedAt).toBe("2026-01-01T00:00:00.000Z");
  }, 30_000);

  it("rejects a village outside Saba", async () => {
    await seedUser("uid-1");
    await expect(
      updateUserProfile({
        uid: "uid-1",
        displayName: "Seeded User",
        phone: "+599 416 0000",
        village: "Not A Village",
        deliveryDirections: "Blue gate.",
      }),
    ).rejects.toThrow("INVALID_VILLAGE");
  }, 30_000);

  it("never modifies roles — role changes are a staff-only operation", async () => {
    await seedUser("uid-1", { roles: ["viewer"] });

    await updateUserProfile({
      uid: "uid-1",
      displayName: "Seeded User",
      phone: "+599 416 0000",
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
    });

    const profile = await getUserProfile("uid-1");
    expect(profile?.roles).toEqual(["viewer"]);
  }, 30_000);
});

describe("confirmDeliveryProfile — server-side completeness guard", () => {
  it("rejects a missing profile", async () => {
    await expect(confirmDeliveryProfile("uid-missing")).rejects.toThrow(
      "USER_NOT_FOUND",
    );
  }, 30_000);

  it.each([
    ["missing phone", { phone: null }],
    ["missing village", { village: null }],
    ["missing directions", { deliveryDirections: null }],
    ["invalid village", { village: "Not A Village" }],
  ])(
    "rejects an incomplete profile (%s)",
    async (_label, overrides) => {
      await seedUser("uid-1", overrides);
      await expect(confirmDeliveryProfile("uid-1")).rejects.toThrow(
        "DELIVERY_PROFILE_INCOMPLETE",
      );
      const stored = (await db.collection(USERS).doc("uid-1").get()).data()!;
      expect(stored.deliveryProfileConfirmedAt).toBeNull();
    },
    30_000,
  );

  it("confirms a complete profile using the server clock", async () => {
    await seedUser("uid-1");

    const confirmed = await confirmDeliveryProfile("uid-1");

    expect(confirmed.deliveryProfileConfirmedAt).not.toBeNull();
    const stored = (await db.collection(USERS).doc("uid-1").get()).data()!;
    expect(stored.deliveryProfileConfirmedAt).not.toBeNull();
  }, 30_000);
});
