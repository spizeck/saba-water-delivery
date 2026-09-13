import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getNextOfferForDriver } from "@/lib/domain/dispatch";
import {
  cancelOwnWaterRequest,
  claimWaterRequest,
  createWaterRequest,
  expirePreferredDriverHold,
  getActiveRequestForCustomer,
  getBatchEligibleRequests,
  getRequestEvents,
} from "@/lib/domain/waterRequests";

/**
 * Emulator-backed tests for resident self-service cancellation
 * (issue #23) — `cancelOwnWaterRequest()`. The pure eligibility rules
 * live in `residentCancellation.test.ts`; these tests prove the
 * Firestore transaction enforces them against COMMITTED state, that the
 * audit event commits atomically with the state change (issue #49
 * convention), and that the lifecycle races the feature exists to
 * handle (claim, delivery-run commitment, hold transition, concurrent
 * cancellation) can never produce a torn state.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const OFFERS = "driverOffers";
const BATCHES = "dispatchBatches";
const USERS = "users";

const RESIDENT = "resident-uid-1";
const OTHER_RESIDENT = "resident-uid-2";
const DRIVER = "driver-uid-1";

async function clearState(): Promise<void> {
  for (const c of [REQUESTS, REGISTRY, OFFERS, BATCHES, USERS]) {
    await db.recursiveDelete(db.collection(c));
  }
}

async function seedRequest(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await db
    .collection(REQUESTS)
    .doc(id)
    .set({
      customerId: RESIDENT,
      customer: {
        displayName: "Resident One",
        phone: "+599 416 0000",
        email: null,
        isRegistered: true,
      },
      source: "resident",
      createdBy: null,
      loads: 1,
      gallons: 1000,
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
      requestNotes: null,
      preferredDriverId: null,
      preferredDriverExpiresAt: null,
      assignedDriverId: null,
      status: "available",
      dispatchPriority: "normal",
      priorityRank: 2,
      prioritySource: "system",
      priorityReason: null,
      dispatchBatchId: null,
      batchSequence: null,
      dispatchOverrideRank: null,
      loadCollections: null,
      requestedAt: now,
      availableAt: now,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

async function seedDriver(
  driverId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await db
    .collection(REGISTRY)
    .doc(`reg-${driverId}`)
    .set({
      displayName: `Driver ${driverId}`,
      phone: null,
      linkedUserId: driverId,
      eligibilityStatus: "eligible",
      availabilityStatus: "online",
      ineligibilityReason: null,
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      createdAt: now,
      createdBy: "seed",
      updatedAt: now,
      updatedBy: "seed",
      ...overrides,
    });
}

async function requestData(id: string) {
  const snap = await db.collection(REQUESTS).doc(id).get();
  return snap.data();
}

async function requestEventTypes(id: string) {
  const events = await getRequestEvents(id);
  return events.map((e) => e.type);
}

/** See the identical helper in auditEventAtomicity.emulator.test.ts. */
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

beforeEach(clearState);
afterAll(clearState);

describe("cancelOwnWaterRequest — happy path", () => {
  it("cancels the resident's own available request and records the resident audit event", async () => {
    await seedRequest("r1");

    const result = await cancelOwnWaterRequest({
      requestId: "r1",
      customerId: RESIDENT,
    });

    expect(result.status).toBe("cancelled");
    const data = await requestData("r1");
    expect(data?.status).toBe("cancelled");

    const events = await getRequestEvents("r1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("request_cancelled_by_resident");
    expect(events[0].actorId).toBe(RESIDENT);
    expect(events[0].actorRole).toBe("resident");
    expect(events[0].metadata?.previousStatus).toBe("available");
  }, 30_000);

  it("cancels a request still in a preferred-driver hold, and the hold never resurfaces it", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await seedRequest("r1", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: expiresAt,
      availableAt: null,
    });

    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });

    expect((await requestData("r1"))?.status).toBe("cancelled");

    // The lazy hold-expiry sweep must not resurrect a cancelled hold
    // into "available" — the request is resolved, not merely expired.
    await expirePreferredDriverHold({ requestId: "r1" });
    const data = await requestData("r1");
    expect(data?.status).toBe("cancelled");
    expect(await requestEventTypes("r1")).toEqual([
      "request_cancelled_by_resident",
    ]);
  }, 30_000);

  it("cancels a request still in the legacy 'requested' status", async () => {
    await seedRequest("r1", { status: "requested" });
    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });
    expect((await requestData("r1"))?.status).toBe("cancelled");
  }, 30_000);
});

describe("cancelOwnWaterRequest — rejections", () => {
  it("rejects another resident's request", async () => {
    await seedRequest("r1");
    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: OTHER_RESIDENT }),
    ).rejects.toThrow("NOT_REQUEST_OWNER");
    expect((await requestData("r1"))?.status).toBe("available");
  }, 30_000);

  it("rejects an unregistered customer's request (customerId null can never match a uid)", async () => {
    await seedRequest("r1", {
      customerId: null,
      customer: {
        displayName: "Walk-in Customer",
        phone: "+599 416 9999",
        email: null,
        isRegistered: false,
      },
      source: "dispatcher",
    });
    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ).rejects.toThrow("NOT_REQUEST_OWNER");
    expect((await requestData("r1"))?.status).toBe("available");
  }, 30_000);

  it.each(["claimed", "delivered", "confirmed", "disputed"] as const)(
    "rejects a %s request — already inside physical delivery operations",
    async (status) => {
      await seedRequest("r1", {
        status,
        assignedDriverId: status === "claimed" ? DRIVER : null,
      });
      await expect(
        cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
      ).rejects.toThrow("REQUEST_NOT_CANCELLABLE");
      expect((await requestData("r1"))?.status).toBe(status);
    },
    30_000,
  );

  it("rejects an already-cancelled request without rewriting history", async () => {
    await seedRequest("r1", { status: "cancelled" });
    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ).rejects.toThrow("REQUEST_ALREADY_CANCELLED");
    expect(await requestEventTypes("r1")).toHaveLength(0);
  }, 30_000);

  it("rejects a missing request", async () => {
    await expect(
      cancelOwnWaterRequest({ requestId: "nope", customerId: RESIDENT }),
    ).rejects.toThrow("REQUEST_NOT_FOUND");
  }, 30_000);

  it("rejects a superficially-eligible status carrying an assigned driver", async () => {
    await seedRequest("r1", {
      status: "available",
      assignedDriverId: DRIVER,
    });
    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ).rejects.toThrow("REQUEST_NOT_CANCELLABLE");
  }, 30_000);

  it("rejects a superficially-eligible status committed to a delivery run", async () => {
    await seedRequest("r1", {
      status: "available",
      dispatchBatchId: "batch-1",
      batchSequence: 1,
    });
    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ).rejects.toThrow("REQUEST_NOT_CANCELLABLE");
    expect((await requestData("r1"))?.dispatchBatchId).toBe("batch-1");
  }, 30_000);
});

describe("cancelOwnWaterRequest — concurrency", () => {
  it("a driver claim committed first defeats the stale-page cancellation", async () => {
    await seedRequest("r1");
    await seedDriver(DRIVER);

    await claimWaterRequest({ requestId: "r1", driverId: DRIVER });

    await expect(
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ).rejects.toThrow("REQUEST_NOT_CANCELLABLE");

    const data = await requestData("r1");
    expect(data?.status).toBe("claimed");
    expect(data?.assignedDriverId).toBe(DRIVER);
    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    expect(reg.data()?.activeRequestId).toBe("r1");
  }, 30_000);

  it("a resident cancellation committed first defeats the stale-offer claim", async () => {
    await seedRequest("r1");
    await seedDriver(DRIVER);

    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });

    await expect(
      claimWaterRequest({ requestId: "r1", driverId: DRIVER }),
    ).rejects.toThrow("REQUEST_NOT_CLAIMABLE");

    const data = await requestData("r1");
    expect(data?.status).toBe("cancelled");
    expect(data?.assignedDriverId).toBeNull();
    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    expect(reg.data()?.activeRequestId).toBeNull();
    expect(await requestEventTypes("r1")).not.toContain("driver_claimed");
  }, 30_000);

  it("a simultaneous claim and cancellation resolve to exactly one consistent outcome", async () => {
    await seedRequest("r1");
    await seedDriver(DRIVER);

    const [claimResult, cancelResult] = await Promise.allSettled([
      claimWaterRequest({ requestId: "r1", driverId: DRIVER }),
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ]);

    const data = await requestData("r1");
    const types = await requestEventTypes("r1");
    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();

    if (data?.status === "claimed") {
      // The claim won: it must be fully consistent — driver assigned,
      // lock held, no resident cancellation recorded.
      expect(claimResult.status).toBe("fulfilled");
      expect(cancelResult.status).toBe("rejected");
      expect(data?.assignedDriverId).toBe(DRIVER);
      expect(reg.data()?.activeRequestId).toBe("r1");
      expect(types).toContain("driver_claimed");
      expect(types).not.toContain("request_cancelled_by_resident");
    } else {
      // The cancellation won: no assignment, no driver lock, and the
      // resident audit event is present.
      expect(data?.status).toBe("cancelled");
      expect(cancelResult.status).toBe("fulfilled");
      expect(claimResult.status).toBe("rejected");
      expect(data?.assignedDriverId).toBeNull();
      expect(reg.data()?.activeRequestId).toBeNull();
      expect(types).toContain("request_cancelled_by_resident");
      expect(types).not.toContain("driver_claimed");
    }
  }, 30_000);

  it("a second concurrent resident cancellation is rejected safely", async () => {
    await seedRequest("r1");

    const [first, second] = await Promise.allSettled([
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
      cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
    ]);

    const data = await requestData("r1");
    expect(data?.status).toBe("cancelled");

    const succeeded = [first, second].filter(
      (r) => r.status === "fulfilled",
    ).length;
    expect(succeeded).toBe(1);

    // Exactly one resident cancellation event — never a duplicated or
    // rewritten audit record.
    const events = await getRequestEvents("r1");
    expect(
      events.filter((e) => e.type === "request_cancelled_by_resident"),
    ).toHaveLength(1);
  }, 30_000);
});

describe("cancelOwnWaterRequest — atomic audit (issue #49 convention)", () => {
  it("commits neither the status change nor the audit event when the transaction fails", async () => {
    await seedRequest("r1");
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    expect((await requestData("r1"))?.status).toBe("available");
    expect(await requestEventTypes("r1")).toHaveLength(0);
  }, 30_000);
});

describe("cancelOwnWaterRequest — downstream behavior", () => {
  it("frees the one-active-request slot so the resident can request again", async () => {
    await seedRequest("r1");
    expect(await getActiveRequestForCustomer(RESIDENT)).not.toBeNull();

    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });

    expect(await getActiveRequestForCustomer(RESIDENT)).toBeNull();

    const created = await createWaterRequest({
      customerId: RESIDENT,
      loads: 1,
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
      customer: {
        displayName: "Resident One",
        phone: "+599 416 0000",
        email: null,
      },
      waterSituation: { reportedUrgency: "normal" },
      attestationAccepted: true,
    });
    expect(created.status).toBe("available");
    expect(created.id).not.toBe("r1");
  }, 30_000);

  it("excludes the cancelled request from fresh driver offers and expires a pending offer", async () => {
    await seedRequest("r1");
    await seedDriver(DRIVER);

    // The request is offered while it is still available.
    const offered = await getNextOfferForDriver(DRIVER);
    expect(offered?.request.id).toBe("r1");

    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });

    // No fresh offer selects it, and the stale pending offer is expired
    // rather than re-presented.
    const next = await getNextOfferForDriver(DRIVER);
    expect(next).toBeNull();

    const offerSnap = await db.collection(OFFERS).doc(offered!.offer.id).get();
    expect(offerSnap.data()?.response).toBe("expired");
  }, 30_000);

  it("excludes the cancelled request from batch (delivery run) eligibility", async () => {
    await seedRequest("r1");
    expect((await getBatchEligibleRequests()).map((r) => r.id)).toContain("r1");

    await cancelOwnWaterRequest({ requestId: "r1", customerId: RESIDENT });

    expect((await getBatchEligibleRequests()).map((r) => r.id)).not.toContain(
      "r1",
    );
  }, 30_000);
});
