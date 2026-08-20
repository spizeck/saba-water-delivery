import { describe, expect, it } from "vitest";

import {
  isOfferableToDriver,
  selectNextDispatchCandidate,
} from "@/lib/domain/dispatchSelection";
import type {
  DriverOffer,
  StandardLoadGallons,
  WaterRequest,
} from "@/lib/domain/types";

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
    gallons: 1000 as StandardLoadGallons,
    village: "Test Village",
    deliveryDirections: "Test directions",
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
    ...overrides,
  };
}

function makePendingOffer(request: WaterRequest): { offer: DriverOffer; request: WaterRequest } {
  return {
    offer: {
      id: `offer-${request.id}`,
      requestId: request.id,
      driverId: "driver-1",
      offeredAt: baseTime.toISOString(),
      response: null,
      respondedAt: null,
    },
    request,
  };
}

function priorityRank(priority: WaterRequest["dispatchPriority"]): number {
  return { critical: 0, urgent: 1, normal: 2 }[priority];
}

function byPriorityThenAge(a: WaterRequest, b: WaterRequest): number {
  const rankDiff = priorityRank(a.dispatchPriority) - priorityRank(b.dispatchPriority);
  if (rankDiff !== 0) return rankDiff;
  return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
}

describe("dispatch selection", () => {
  const driverId = "driver-1";

  it("offers the next available request after a delivery is completed", () => {
    const _requestA = makeRequest("req-a", "delivered", {
      assignedDriverId: driverId,
      deliveredAt: baseTime.toISOString(),
    });
    const requestB = makeRequest("req-b", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
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
      pendingOffer: null,
      holds: [],
      available: [requestC],
      declinedRequestIds: new Set(),
      driverId,
      now: new Date(baseTime.getTime() + 120_000),
    });

    expect(result).toEqual(requestC);
  });

  it("excludes recently-declined requests but still offers other available requests", () => {
    const requestA = makeRequest("req-a", "available");
    const requestB = makeRequest("req-b", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
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
      pendingOffer: null,
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
      pendingOffer: null,
      holds: [],
      available: [normal, urgent, critical].sort(byPriorityThenAge),
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(critical);
  });

  it("breaks priority ties by oldest request first", () => {
    const older = makeRequest("req-older", "available", {
      requestedAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });
    const newer = makeRequest("req-newer", "available", {
      requestedAt: baseTime.toISOString(),
    });

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
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
      preferredDriverExpiresAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
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
      preferredDriverExpiresAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
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
      preferredDriverExpiresAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: null,
      holds: [hold],
      available: [available],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(available);
  });

  it("reuses a pending offer when the request is still offerable", () => {
    const request = makeRequest("req-pending", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: makePendingOffer(request),
      holds: [],
      available: [makeRequest("req-other", "available")],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(request);
  });

  it("drops a stale pending offer and selects from the available queue", () => {
    const stalePending = makeRequest("req-stale", "delivered", {
      assignedDriverId: driverId,
      deliveredAt: baseTime.toISOString(),
    });
    const available = makeRequest("req-available", "available");

    const result = selectNextDispatchCandidate({
      pendingOffer: makePendingOffer(stalePending),
      holds: [],
      available: [available],
      declinedRequestIds: new Set(),
      driverId,
      now: baseTime,
    });

    expect(result).toEqual(available);
  });
});

describe("isOfferableToDriver", () => {
  const driverId = "driver-1";
  const now = baseTime;

  it("offers available requests with no assigned driver", () => {
    const request = makeRequest("req", "available");
    expect(isOfferableToDriver(request, driverId, now)).toBe(true);
  });

  it("does not offer available requests that are already assigned", () => {
    const request = makeRequest("req", "available", {
      assignedDriverId: "driver-2",
    });
    expect(isOfferableToDriver(request, driverId, now)).toBe(false);
  });

  it("offers an active preferred-driver hold addressed to this driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    expect(isOfferableToDriver(request, driverId, now)).toBe(true);
  });

  it("does not offer a preferred-driver hold addressed to another driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: "driver-2",
      preferredDriverExpiresAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    expect(isOfferableToDriver(request, driverId, now)).toBe(false);
  });

  it("does not offer an expired preferred-driver hold even for this driver", () => {
    const request = makeRequest("req", "preferred_driver_hold", {
      preferredDriverId: driverId,
      preferredDriverExpiresAt: new Date(baseTime.getTime() - 60_000).toISOString(),
    });
    expect(isOfferableToDriver(request, driverId, now)).toBe(false);
  });
});
