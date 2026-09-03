import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminDb: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: mocks.getAdminDb }));
vi.mock("@/lib/email/deliveryConfirmationNotification", () => ({
  notifyDeliveryConfirmation: mocks.notify,
}));

import { markWaterDelivered, markWaterDeliveredByStaff } from "../waterRequests";

function timestamp() {
  return { toDate: () => new Date("2026-09-02T18:30:00.000Z") };
}

function deliveredData() {
  return {
    customerId: "resident-1",
    customer: { displayName: "Jane", email: "jane@example.com", phone: null, isRegistered: true },
    source: "resident",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue(undefined);
});

describe("delivery confirmation notification trigger", () => {
  it("notifies after a registered request is marked delivered by its driver", async () => {
    const requestRef = {
      collection: () => ({ doc: () => ({}) }),
      get: vi.fn().mockResolvedValue({ exists: true, data: () => deliveredData() }),
    };
    const driverDoc = { data: () => ({ activeRequestId: "request-1" }), ref: {} };
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ ...deliveredData(), status: "claimed" }) })
        .mockResolvedValueOnce({ empty: false, docs: [driverDoc] }),
      update: vi.fn(),
      set: vi.fn(),
    };
    const collection = vi.fn((name: string) =>
      name === "waterRequests"
        ? { doc: () => requestRef }
        : { where: () => ({ limit: () => ({}) }) },
    );
    mocks.getAdminDb.mockReturnValue({
      collection,
      runTransaction: async (callback: (txn: typeof transaction) => Promise<void>) => callback(transaction),
    });

    await markWaterDelivered({ requestId: "request-1", driverId: "driver-1" });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ id: "request-1", status: "delivered" }));
  });

  it("uses the same notification after staff marks delivery", async () => {
    const requestRef = {
      collection: () => ({ doc: () => ({}) }),
      get: vi.fn().mockResolvedValue({ exists: true, data: () => deliveredData() }),
    };
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({ exists: true, data: () => ({ ...deliveredData(), status: "claimed" }) })
        .mockResolvedValueOnce({ empty: true, docs: [] }),
      update: vi.fn(),
      set: vi.fn(),
    };
    const collection = vi.fn((name: string) =>
      name === "waterRequests"
        ? { doc: () => requestRef }
        : { where: () => ({ limit: () => ({}) }) },
    );
    mocks.getAdminDb.mockReturnValue({
      collection,
      runTransaction: async (callback: (txn: typeof transaction) => Promise<void>) => callback(transaction),
    });

    await markWaterDeliveredByStaff({
      requestId: "request-1",
      actorId: "dispatcher-1",
      note: "Confirmed by radio",
    });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ id: "request-1", status: "delivered" }));
  });
});
