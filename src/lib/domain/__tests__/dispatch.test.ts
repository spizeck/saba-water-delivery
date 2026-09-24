import { describe, expect, it } from "vitest";

import {
  isAssignableToDriver,
  selectNextDispatchCandidate,
} from "@/lib/domain/dispatchSelection";
import type { StandardLoadGallons, WaterRequest } from "@/lib/domain/types";

const baseTime = new Date("2026-08-20T12:00:00.000Z");

function makeRequest(
  id: string,
  status: WaterRequest["status"],
  overrides: Partial<WaterRequest> = {},
): WaterRequest {
  return {
    id,
    customerId: null,
    customer: null,
    source: "resident",
    createdBy: null,
    loads: 1,
    gallons: 1000 as StandardLoadGallons,
    village: "Test Village",
    deliveryDirections: "Test directions",
    requestNotes: null,
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: null,
    status,
    waterSituation: null,
    attestationAccepted: null,
    attestationAcceptedAt: null,
    dispatchPriority: "normal",
    prioritySource: "system",
    priorityReason: null,
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: baseTime.toISOString(),
    availableAt: null,
    claimedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
    dispatchBatchId: null,
    batchSequence: null,
    dispatchOverrideRank: null,
    loadCollections: null,
    ...overrides,
  };
}

function priorityRank(priority: WaterRequest["dispatchPriority"]): number {
  return { critical: 0, urgent: 1, normal: 2 }[priority];
}

function byPriorityThenAge(a: WaterRequest, b: WaterRequest): number {
  const rankDiff =
    priorityRank(a.dispatchPriority) - priorityRank(b.dispatchPriority);
  if (rankDiff !== 0) return rankDiff;
  return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
}

describe("dispatch selection", () => {
  const driverId = "driver-1";

  it("selects the next available request after a delivery is completed", () => {
    const _requestA = makeRequest("req-a", "delivered", {
      assignedDriverId: driverId,
      deliveredAt: baseTime.toISOString(),
    });
    const requestB = makeRequest("req-b", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [requestB],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(requestB);
  });

  it("supports multiple sequential deliveries", () => {
    const _requestA = makeRequest("req-a", "delivered", {
      assignedDriverId: driverId,
      deliveredAt: baseTime.toISOString(),
    });
    const _requestB = makeRequest("req-b", "delivered", {
      assignedDriverId: driverId,
      deliveredAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    const requestC = makeRequest("req-c", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [requestC],
      declinedRequestIds: new Set(),
      driverId,
      now: new Date(baseTime.getTime() + 120_000),
    });

    expect(result).toEqual(requestC);
  });

  it("does not select a new request while the driver has an active claimed delivery", () => {
    const activeDelivery = makeRequest("req-active", "claimed", {
      assignedDriverId: driverId,
      claimedAt: baseTime.toISOString(),
    });
    const requestB = makeRequest("req-b", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery,
      holds: [],
      available: [requestB],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toBeNull();
  });

  it("excludes recently-declined requests but still selects other available requests", () => {
    const requestA = makeRequest("req-a", "available");
    const requestB = makeRequest("req-b", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [requestA, requestB],
      declinedRequestIds: new Set([requestA.id]),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(requestB);
  });

  it("returns null when all available requests have been recently declined", () => {
    const requestA = makeRequest("req-a", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [requestA],
      declinedRequestIds: new Set([requestA.id]),
      driverId,
      now: baseTime,
    });

    expect(result).toBeNull();
  });

  it("returns higher-priority requests before lower-priority requests", () => {
    const normal = makeRequest("req-normal", "available", {
      dispatchPriority: "normal",
      requestedAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });
    const urgent = makeRequest("req-urgent", "available", {
      dispatchPriority: "urgent",
      requestedAt: baseTime.toISOString(),
    });
    const critical = makeRequest("req-critical", "available", {
      dispatchPriority: "critical",
      requestedAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [normal, urgent, critical].sort(byPriorityThenAge),
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(critical);
  });

  it("picks an escalated (dispatchOverrideRank 0) request when it appears first in the sorted available list", () => {
    const escalated = makeRequest("req-escalated", "available", {
      dispatchOverrideRank: 0,
      requestedAt: baseTime.toISOString(),
    });
    const older = makeRequest("req-older", "available", {
      requestedAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [escalated, older],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(escalated);
  });

  it("breaks priority ties by oldest request first", () => {
    const older = makeRequest("req-older", "available", {
      requestedAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });
    const newer = makeRequest("req-newer", "available", {
      requestedAt: baseTime.toISOString(),
    });

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [],
      available: [older, newer],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(older);
  });

  it("prefers an active preferred-driver hold addressed to this driver", () => {
    const hold = makeRequest("req-hold", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() + 60_000,
      ).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [hold],
      available: [available],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(hold);
  });

  it("ignores an expired preferred-driver hold for this driver", () => {
    const hold = makeRequest("req-hold", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() - 60_000,
      ).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [hold],
      available: [available],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(available);
  });

  it("ignores a preferred-driver hold addressed to another driver", () => {
    const hold = makeRequest("req-hold", "preferred_driver_hold", {
      preferredDriverId: "driver-2",
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() + 60_000,
      ).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      activeDelivery: null,
      holds: [hold],
      available: [available],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(available);
  });
});

describe("isAssignableToDriver", () => {
  const driverId = "driver-1";
  const now = baseTime;

  it("assigns available requests with no assigned driver", () => {
    const request = makeRequest("req", "available");
    expect(isAssignableToDriver(request, driverId, now)).toBe(true);
  });

  it("does not assign available requests that are already assigned", () => {
    const request = makeRequest("req", "available", {
      assignedDriverId: "driver-2",
    });
    expect(isAssignableToDriver(request, driverId, now)).toBe(false);
  });

  it("assigns an active preferred-driver hold addressed to this driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() + 60_000,
      ).toISOString(),
    });
    expect(isAssignableToDriver(request, driverId, now)).toBe(true);
  });

  it("does not assign a preferred-driver hold addressed to another driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: "driver-2",
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() + 60_000,
      ).toISOString(),
    });
    expect(isAssignableToDriver(request, driverId, now)).toBe(false);
  });

  it("does not assign an expired preferred-driver hold even for this driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(
        baseTime.getTime() - 60_000,
      ).toISOString(),
    });
    expect(isAssignableToDriver(request, driverId, now)).toBe(false);
  });
});
