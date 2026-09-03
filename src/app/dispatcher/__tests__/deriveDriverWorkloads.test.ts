import { describe, expect, it } from "vitest";

import type { DriverRegistryEntry, WaterRequest } from "@/lib/domain/types";

import { deriveDriverWorkloads } from "../deriveDriverWorkloads";

const baseDriver = {
  id: "driver-1",
  displayName: "Andy Lavia",
  phone: null,
  eligibilityStatus: "eligible",
  ineligibilityReason: null,
  restrictedAt: null,
  restrictedBy: null,
  cooldownUntil: null,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  archivedPreviousEligibilityStatus: null,
  archivedPreviousIneligibilityReason: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2024-01-01T00:00:00.000Z",
  updatedBy: "admin",
} as const;

const online = {
  ...baseDriver,
  linkedUserId: "user-1",
  availabilityStatus: "online" as const,
  activeRequestId: null,
} as DriverRegistryEntry;

const offline = {
  ...baseDriver,
  id: "driver-2",
  displayName: "Bruce Owen",
  linkedUserId: "user-2",
  availabilityStatus: "offline" as const,
  activeRequestId: null,
} as DriverRegistryEntry;

const baseRequest = {
  customerId: null,
  customer: { displayName: "Customer" },
  source: "resident" as const,
  createdBy: null,
  gallons: 1000 as const,
  deliveryDirections: "",
  requestNotes: null,
  preferredDriverId: null,
  preferredDriverExpiresAt: null,
  waterSituation: null,
  attestationAccepted: true,
  attestationAcceptedAt: null,
  dispatchPriority: "normal" as const,
  prioritySource: "initial" as const,
  priorityReason: null,
  priorityUpdatedBy: null,
  priorityUpdatedAt: null,
  requestedAt: "2024-01-01T00:00:00.000Z",
  availableAt: null,
  claimedAt: null,
  deliveredAt: null,
  confirmedAt: null,
  dispatchOverrideRank: null,
  loadCollections: [],
} as const;

function makeRequest(overrides: Partial<WaterRequest>): WaterRequest {
  return {
    ...baseRequest,
    ...overrides,
  } as WaterRequest;
}

const customerNames: Record<string, string> = {
  "req-1": "Earl Ballantyne",
  "req-2": "John Smith",
  "req-3": "Government",
  "req-4": "Simmons",
};

describe("deriveDriverWorkloads", () => {
  it("marks an online driver with no claimed work as available", () => {
    const result = deriveDriverWorkloads([online], [], customerNames);
    expect(result["driver-1"].state).toBe("available");
    expect(result["driver-1"].openRequests).toBe(0);
    expect(result["driver-1"].openLoads).toBe(0);
    expect(result["driver-1"].individualRequests).toHaveLength(0);
    expect(result["driver-1"].runs).toHaveLength(0);
  });

  it("marks an offline driver as offline even if the registry has a stale activeRequestId", () => {
    const staleOffline = {
      ...offline,
      activeRequestId: "req-old",
    } as DriverRegistryEntry;
    const result = deriveDriverWorkloads([staleOffline], [], customerNames);
    expect(result["driver-2"].state).toBe("offline");
    expect(result["driver-2"].openRequests).toBe(0);
  });

  it("shows an individual claimed delivery for an online driver", () => {
    const requests = [
      makeRequest({
        id: "req-1",
        assignedDriverId: "user-1",
        status: "claimed",
        village: "Zions Hill - Upper",
        loads: 1,
        dispatchBatchId: null,
      }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].state).toBe("individual");
    expect(result["driver-1"].openRequests).toBe(1);
    expect(result["driver-1"].openLoads).toBe(1);
    expect(result["driver-1"].individualRequests).toHaveLength(1);
    expect(result["driver-1"].individualRequests[0].requestId).toBe("req-1");
    expect(result["driver-1"].individualRequests[0].customerName).toBe("Earl Ballantyne");
    expect(result["driver-1"].runs).toHaveLength(0);
  });

  it("shows an active Delivery Run with remaining deliveries and loads", () => {
    const requests = [
      makeRequest({
        id: "req-3",
        assignedDriverId: "user-1",
        status: "claimed",
        village: "The Bottom",
        loads: 2,
        dispatchBatchId: "batch-1",
      }),
      makeRequest({
        id: "req-4",
        assignedDriverId: "user-1",
        status: "claimed",
        village: "Windwardside",
        loads: 1,
        dispatchBatchId: "batch-1",
      }),
      makeRequest({
        id: "req-5",
        assignedDriverId: "user-1",
        status: "delivered",
        village: "St. Johns",
        loads: 1,
        dispatchBatchId: "batch-1",
        deliveredAt: "2024-01-01T12:00:00.000Z",
      }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].state).toBe("delivery_run");
    expect(result["driver-1"].openRequests).toBe(2);
    expect(result["driver-1"].openLoads).toBe(3);
    expect(result["driver-1"].runs).toHaveLength(1);
    expect(result["driver-1"].runs[0].batchId).toBe("batch-1");
    expect(result["driver-1"].runs[0].remainingStops).toBe(2);
    expect(result["driver-1"].runs[0].remainingLoads).toBe(3);
    expect(result["driver-1"].runs[0].totalStops).toBe(3);
    expect(result["driver-1"].runs[0].totalLoads).toBe(4);
    expect(result["driver-1"].runs[0].link).toBe("/dispatcher/batches/batch-1");
  });

  it("does not count a delivered, confirmed, disputed, or cancelled request as active", () => {
    const requests = [
      makeRequest({ id: "r-delivered", assignedDriverId: "user-1", status: "delivered", loads: 1, dispatchBatchId: null }),
      makeRequest({ id: "r-confirmed", assignedDriverId: "user-1", status: "confirmed", loads: 1, dispatchBatchId: null }),
      makeRequest({ id: "r-disputed", assignedDriverId: "user-1", status: "disputed", loads: 1, dispatchBatchId: null }),
      makeRequest({ id: "r-cancelled", assignedDriverId: "user-1", status: "cancelled", loads: 1, dispatchBatchId: null }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].state).toBe("available");
    expect(result["driver-1"].openRequests).toBe(0);
    expect(result["driver-1"].openLoads).toBe(0);
  });

  it("does not show a completed Delivery Run as active", () => {
    const requests = [
      makeRequest({ id: "req-a", assignedDriverId: "user-1", status: "confirmed", loads: 1, dispatchBatchId: "batch-2" }),
      makeRequest({ id: "req-b", assignedDriverId: "user-1", status: "disputed", loads: 2, dispatchBatchId: "batch-2" }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].state).toBe("available");
    expect(result["driver-1"].runs).toHaveLength(0);
  });

  it("does not let a stale activeRequestId create false workload", () => {
    const driverWithStale = { ...online, activeRequestId: "stale" } as DriverRegistryEntry;
    const result = deriveDriverWorkloads([driverWithStale], [], customerNames);
    expect(result["driver-1"].state).toBe("available");
    expect(result["driver-1"].openRequests).toBe(0);
  });

  it("only uses canonical online/offline status, not activeRequestId, for availability", () => {
    const offlineWithWork = { ...offline, activeRequestId: null } as DriverRegistryEntry;
    const requests = [
      makeRequest({
        id: "req-1",
        assignedDriverId: "user-2",
        status: "claimed",
        village: "Zions Hill - Upper",
        loads: 1,
        dispatchBatchId: null,
      }),
    ];
    const result = deriveDriverWorkloads([offlineWithWork], requests, customerNames);
    expect(result["driver-2"].state).toBe("offline");
    expect(result["driver-2"].openRequests).toBe(1);
  });

  it("links individual requests to the request detail route", () => {
    const requests = [
      makeRequest({
        id: "req-2",
        assignedDriverId: "user-1",
        status: "claimed",
        village: "Zions Hill - Upper",
        loads: 1,
        dispatchBatchId: null,
      }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].individualRequests[0].requestId).toBe("req-2");
  });

  it("links active Delivery Runs to the batch detail route", () => {
    const requests = [
      makeRequest({
        id: "req-3",
        assignedDriverId: "user-1",
        status: "claimed",
        village: "The Bottom",
        loads: 1,
        dispatchBatchId: "batch-1",
      }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].runs[0].link).toBe("/dispatcher/batches/batch-1");
  });

  it("keeps assignment and concurrency protections by ignoring unassigned claimed requests", () => {
    const requests = [
      makeRequest({ id: "unassigned", assignedDriverId: null, status: "claimed", village: "The Bottom", loads: 1, dispatchBatchId: null }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].openRequests).toBe(0);
  });

  it("does not create false workload for an orphaned request assigned to a missing driver", () => {
    const requests = [
      makeRequest({ id: "orphan", assignedDriverId: "unknown-user", status: "claimed", village: "The Bottom", loads: 1, dispatchBatchId: null }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].openRequests).toBe(0);
  });

  it("supports multiple active runs and individual requests for the same driver truthfully", () => {
    const requests = [
      makeRequest({ id: "ind-1", assignedDriverId: "user-1", status: "claimed", village: "Village A", loads: 1, dispatchBatchId: null }),
      makeRequest({ id: "run-1", assignedDriverId: "user-1", status: "claimed", village: "Village B", loads: 1, dispatchBatchId: "batch-A" }),
      makeRequest({ id: "run-2", assignedDriverId: "user-1", status: "claimed", village: "Village C", loads: 2, dispatchBatchId: "batch-B" }),
    ];
    const result = deriveDriverWorkloads([online], requests, customerNames);
    expect(result["driver-1"].state).toBe("delivery_run");
    expect(result["driver-1"].openRequests).toBe(3);
    expect(result["driver-1"].individualRequests).toHaveLength(1);
    expect(result["driver-1"].runs).toHaveLength(2);
  });
});
