import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: mocks.getAdminDb }));

import {
  markWaterDelivered,
  markWaterDeliveredByStaff,
} from "../waterRequests";

/**
 * Fast (non-emulator) coverage that the delivery transitions STAGE a durable
 * delivery-confirmation outbox intent (issue #53) as part of the transaction —
 * created for a registered requestor, and NOT created for an unregistered one
 * (who must never get an authenticated confirmation link). The true atomicity /
 * rollback guarantee is proven against the emulator in
 * notificationOutbox.emulator.test.ts; this exercises the wiring without Java.
 */

function timestamp() {
  return { toDate: () => new Date("2026-09-02T18:30:00.000Z") };
}

function deliveredData(customerId: string | null) {
  return {
    customerId,
    customer: customerId
      ? {
          displayName: "Jane",
          email: "jane@example.com",
          phone: null,
          isRegistered: true,
        }
      : null,
    source: customerId ? "resident" : "dispatcher",
    loads: 1,
    gallons: 1000,
    village: "Windwardside",
    deliveryDirections: "Blue gate",
    status: "delivered",
    assignedDriverId: "driver-1",
    requestedAt: timestamp(),
    deliveredAt: timestamp(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    loadCollections: [{ loadNumber: 1 }],
  };
}

/**
 * Builds a fake Admin DB + transaction. `txn.get` returns, in call order:
 * the request (claimed), the driver query, then the outbox doc (absent) — the
 * order the delivery transitions read in. Captures `txn.create` calls.
 */
function makeFakeDb(customerId: string | null) {
  const outboxRef = { __kind: "outboxRef" };
  const requestRef = {
    collection: () => ({ doc: () => ({}) }),
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => deliveredData(customerId),
    }),
  };
  const driverDoc = { data: () => ({ activeRequestId: "request-1" }), ref: {} };

  const gets = [
    {
      exists: true,
      data: () => ({ ...deliveredData(customerId), status: "claimed" }),
    },
    { empty: false, docs: [driverDoc] },
    { exists: false }, // outbox read (only reached when customerId is present)
  ];
  const txn = {
    get: vi.fn().mockImplementation(() => Promise.resolve(gets.shift())),
    update: vi.fn(),
    set: vi.fn(),
    create: vi.fn(),
  };

  const collection = vi.fn((name: string) => {
    if (name === "waterRequests") return { doc: () => requestRef };
    if (name === "notificationOutbox") return { doc: () => outboxRef };
    return { where: () => ({ limit: () => ({}) }) };
  });

  mocks.getAdminDb.mockReturnValue({
    collection,
    runTransaction: async (cb: (t: typeof txn) => Promise<unknown>) => cb(txn),
  });
  return { txn, outboxRef };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delivery confirmation outbox-intent trigger", () => {
  it("stages a delivery-confirmation intent when a registered request is delivered by its driver", async () => {
    const { txn, outboxRef } = makeFakeDb("resident-1");
    await markWaterDelivered({ requestId: "request-1", driverId: "driver-1" });
    expect(txn.create).toHaveBeenCalledOnce();
    expect(txn.create).toHaveBeenCalledWith(
      outboxRef,
      expect.objectContaining({
        type: "delivery_confirmation_email",
        requestId: "request-1",
        customerId: "resident-1",
        state: "pending",
        attemptCount: 0,
        providerIdempotencyKey: "delivery-confirmation-request-1",
      }),
    );
  });

  it("stages the same intent when staff mark the delivery", async () => {
    const { txn, outboxRef } = makeFakeDb("resident-1");
    await markWaterDeliveredByStaff({
      requestId: "request-1",
      actorId: "dispatcher-1",
      note: "Confirmed by radio",
    });
    expect(txn.create).toHaveBeenCalledOnce();
    expect(txn.create).toHaveBeenCalledWith(
      outboxRef,
      expect.objectContaining({
        requestId: "request-1",
        state: "pending",
      }),
    );
  });

  it("does NOT stage an intent for an unregistered requestor (no authenticated link)", async () => {
    const { txn } = makeFakeDb(null);
    await markWaterDelivered({ requestId: "request-1", driverId: "driver-1" });
    expect(txn.create).not.toHaveBeenCalled();
  });
});
