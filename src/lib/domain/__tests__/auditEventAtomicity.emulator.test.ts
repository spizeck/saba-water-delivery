import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  removeMeterAssignment,
  restoreDriver,
  restrictDriver,
  setMeterAssignment,
} from "@/lib/domain/driverRegistry";
import { closeDeliveryRun } from "@/lib/domain/dispatchBatches";
import { registerPerson } from "@/lib/domain/users";

/**
 * Emulator-backed regression tests for issue #49 — the domain mutations that
 * previously wrote their business state and their required audit event as two
 * SEPARATE writes, so the state could commit without its durable audit history:
 *
 *   - restrictDriver / restoreDriver (driver eligibility — the audit event is
 *     the only durable record of a reinstatement, which clears the doc's
 *     restrictedBy/restrictedAt);
 *   - setMeterAssignment / removeMeterAssignment (meter config — the removal
 *     event is the only record the assignment ever existed);
 *   - closeDeliveryRun (batch close — the event is the only record of who
 *     closed the run and why);
 *   - registerPerson (staff-created account — the roleEvent is the durable
 *     role-grant record).
 *
 * Each is now a single transaction. The "transaction fails" tests stage the
 * writes then abort before commit, proving neither the state change NOR the
 * audit event survives.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const REGISTRY = "driverRegistry";
const BATCHES = "dispatchBatches";
const REQUESTS = "waterRequests";
const USERS = "users";

async function clearState(): Promise<void> {
  for (const c of [REGISTRY, BATCHES, REQUESTS, USERS]) {
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

async function seedDriver(
  driverId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db
    .collection(REGISTRY)
    .doc(driverId)
    .set({
      displayName: `Driver ${driverId}`,
      phone: null,
      linkedUserId: null,
      eligibilityStatus: "eligible",
      availabilityStatus: "offline",
      ineligibilityReason: null,
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      createdAt: new Date(),
      createdBy: "seed",
      updatedAt: new Date(),
      updatedBy: "seed",
      ...overrides,
    });
}

async function driverEvents(driverId: string) {
  const snap = await db
    .collection(REGISTRY)
    .doc(driverId)
    .collection("events")
    .get();
  return snap.docs.map((d) => d.data());
}

beforeEach(clearState);
afterAll(clearState);

describe("restrictDriver — atomic eligibility change + audit event (#49)", () => {
  it("commits the restriction and its event together", async () => {
    await seedDriver("d1", { eligibilityStatus: "eligible" });
    await restrictDriver({
      driverId: "d1",
      restrictedBy: "admin-1",
      reason: "policy",
    });

    const doc = await db.collection(REGISTRY).doc("d1").get();
    expect(doc.data()?.eligibilityStatus).toBe("ineligible");
    expect(doc.data()?.restrictedBy).toBe("admin-1");

    const events = await driverEvents("d1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("driver_access_restricted");
    expect(events[0].metadata.reason).toBe("policy");
  }, 30_000);

  it("leaves eligibility unchanged and no event when the transaction fails", async () => {
    await seedDriver("d1", { eligibilityStatus: "eligible" });
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        restrictDriver({
          driverId: "d1",
          restrictedBy: "admin-1",
          reason: "x",
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    const doc = await db.collection(REGISTRY).doc("d1").get();
    expect(doc.data()?.eligibilityStatus).toBe("eligible");
    expect(doc.data()?.restrictedBy).toBeNull();
    expect(await driverEvents("d1")).toHaveLength(0);
  }, 30_000);
});

describe("restoreDriver — atomic reinstatement + audit event (#49)", () => {
  it("commits the reinstatement and its (sole-record) event together", async () => {
    await seedDriver("d1", {
      eligibilityStatus: "ineligible",
      restrictedBy: "admin-1",
      restrictedAt: new Date(),
      ineligibilityReason: "policy",
    });
    await restoreDriver({ driverId: "d1", restoredBy: "admin-2" });

    const doc = await db.collection(REGISTRY).doc("d1").get();
    expect(doc.data()?.eligibilityStatus).toBe("eligible");
    // The doc's restriction attribution is cleared — the audit event is now the
    // only durable record of who reinstated the driver.
    expect(doc.data()?.restrictedBy).toBeNull();

    const events = await driverEvents("d1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("driver_access_restored");
    expect(events[0].actorId).toBe("admin-2");
  }, 30_000);

  it("leaves the restriction intact and no event when the transaction fails", async () => {
    await seedDriver("d1", {
      eligibilityStatus: "ineligible",
      restrictedBy: "admin-1",
      restrictedAt: new Date(),
      ineligibilityReason: "policy",
    });
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        restoreDriver({ driverId: "d1", restoredBy: "admin-2" }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    const doc = await db.collection(REGISTRY).doc("d1").get();
    expect(doc.data()?.eligibilityStatus).toBe("ineligible");
    expect(doc.data()?.restrictedBy).toBe("admin-1");
    expect(await driverEvents("d1")).toHaveLength(0);
  }, 30_000);
});

describe("meter assignment — atomic meter write + audit event (#49)", () => {
  it("commits an added meter and its event together", async () => {
    await seedDriver("d1");
    await setMeterAssignment({
      driverId: "d1",
      stationId: "bottom",
      meterCode: "BTM1",
      meterNumber: 1,
      actorId: "admin-1",
    });

    const meter = await db
      .collection(REGISTRY)
      .doc("d1")
      .collection("meters")
      .doc("bottom")
      .get();
    expect(meter.data()?.meterCode).toBe("BTM1");

    const events = await driverEvents("d1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("meter_assignment_added");
  }, 30_000);

  it("removing a meter deletes it and records the sole-record event together", async () => {
    await seedDriver("d1");
    await setMeterAssignment({
      driverId: "d1",
      stationId: "bottom",
      meterCode: "BTM1",
      meterNumber: 1,
      actorId: "admin-1",
    });
    await removeMeterAssignment({
      driverId: "d1",
      stationId: "bottom",
      actorId: "admin-1",
    });

    const meter = await db
      .collection(REGISTRY)
      .doc("d1")
      .collection("meters")
      .doc("bottom")
      .get();
    expect(meter.exists).toBe(false);
    const events = await driverEvents("d1");
    expect(events.some((e) => e.type === "meter_assignment_removed")).toBe(
      true,
    );
  }, 30_000);

  it("leaves the meter present and no removal event when the removal transaction fails", async () => {
    await seedDriver("d1");
    await setMeterAssignment({
      driverId: "d1",
      stationId: "bottom",
      meterCode: "BTM1",
      meterNumber: 1,
      actorId: "admin-1",
    });
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        removeMeterAssignment({
          driverId: "d1",
          stationId: "bottom",
          actorId: "admin-1",
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    const meter = await db
      .collection(REGISTRY)
      .doc("d1")
      .collection("meters")
      .doc("bottom")
      .get();
    expect(meter.exists).toBe(true);
    expect(
      (await driverEvents("d1")).some(
        (e) => e.type === "meter_assignment_removed",
      ),
    ).toBe(false);
  }, 30_000);
});

describe("closeDeliveryRun — atomic status change + audit event (#49)", () => {
  async function seedBatch(batchId: string): Promise<void> {
    await db.collection(BATCHES).doc(batchId).set({
      driverId: "driver-1",
      driverDisplayName: "Driver One",
      createdBy: "admin-1",
      createdAt: new Date(),
      status: "active",
      originalRequestIds: [],
      generatedAt: null,
      updatedAt: new Date(),
    });
  }

  it("commits the completed status and its close event together", async () => {
    await seedBatch("b1");
    const result = await closeDeliveryRun("b1", "admin-1");
    expect(result.ok).toBe(true);

    const batch = await db.collection(BATCHES).doc("b1").get();
    expect(batch.data()?.status).toBe("completed");

    const events = await db
      .collection(BATCHES)
      .doc("b1")
      .collection("events")
      .get();
    expect(events.docs.map((d) => d.data().type)).toContain(
      "dispatch_batch_closed",
    );
  }, 30_000);

  it("leaves the batch active and no close event when the transaction fails", async () => {
    await seedBatch("b1");
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(closeDeliveryRun("b1", "admin-1")).rejects.toThrow(
        "INJECTED_TXN_FAILURE",
      );
    } finally {
      injected.restore();
    }

    const batch = await db.collection(BATCHES).doc("b1").get();
    expect(batch.data()?.status).toBe("active");
    const events = await db
      .collection(BATCHES)
      .doc("b1")
      .collection("events")
      .get();
    expect(events.size).toBe(0);
  }, 30_000);
});

describe("registerPerson — atomic account creation + audit event (#49)", () => {
  it("commits the person document and its roleEvent together", async () => {
    const { profile } = await registerPerson({
      displayName: "Jane Doe",
      phone: "+1-555-0100",
      email: null,
      village: null,
      deliveryDirections: null,
      roles: ["resident"],
      registeredBy: "admin-1",
    });

    const doc = await db.collection(USERS).doc(profile.uid).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.accountOrigin).toBe("staff_registered");

    const roleEvents = await db
      .collection(USERS)
      .doc(profile.uid)
      .collection("roleEvents")
      .get();
    expect(roleEvents.docs.map((d) => d.data().type)).toContain(
      "person_registered",
    );
  }, 30_000);

  it("creates neither the person document nor its roleEvent when the transaction fails", async () => {
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        registerPerson({
          displayName: "Jane Doe",
          phone: "+1-555-0100",
          email: null,
          village: null,
          deliveryDirections: null,
          roles: ["resident"],
          registeredBy: "admin-1",
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    const users = await db.collection(USERS).get();
    expect(users.size).toBe(0);
  }, 30_000);
});
