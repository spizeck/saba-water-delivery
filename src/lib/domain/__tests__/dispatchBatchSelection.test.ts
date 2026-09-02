import { describe, expect, it } from "vitest";

import {
  type BatchCandidateSnapshot,
  BATCH_ELIGIBLE_STATUSES,
  MAX_BATCH_SIZE,
  computeDispatchBatchStatus,
  deriveRunState,
  sortForBatchSelection,
  validateBatchSelection,
} from "@/lib/domain/dispatchBatchSelection";
import type { StandardLoadGallons, WaterRequest } from "@/lib/domain/types";

const baseTime = new Date("2026-08-20T12:00:00.000Z");

function makeRequest(id: string, overrides: Partial<WaterRequest> = {}): WaterRequest {
  return {
    id,
    customerId: null,
    customer: { displayName: `Customer ${id}`, phone: null, email: null, isRegistered: false },
    source: "resident",
    createdBy: null,
    loads: 1,
    gallons: 1000 as StandardLoadGallons,
    village: "Windwardside",
    deliveryDirections: "Test directions",
    requestNotes: null,
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: null,
    status: "available",
    waterSituation: null,
    attestationAccepted: true,
    attestationAcceptedAt: baseTime.toISOString(),
    dispatchPriority: "normal",
    prioritySource: "system",
    priorityReason: null,
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: baseTime.toISOString(),
    availableAt: baseTime.toISOString(),
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

function snapshotFromRequest(r: WaterRequest): BatchCandidateSnapshot {
  return {
    id: r.id,
    exists: true,
    status: r.status,
    assignedDriverId: r.assignedDriverId,
    preferredDriverId: r.preferredDriverId,
  };
}

describe("sortForBatchSelection", () => {
  it("orders critical before urgent before normal", () => {
    const normal = makeRequest("normal", { dispatchPriority: "normal" });
    const urgent = makeRequest("urgent", { dispatchPriority: "urgent" });
    const critical = makeRequest("critical", { dispatchPriority: "critical" });

    const sorted = sortForBatchSelection([normal, urgent, critical]);

    expect(sorted.map((r) => r.id)).toEqual(["critical", "urgent", "normal"]);
  });

  it("orders oldest first within the same priority", () => {
    const newer = makeRequest("newer", {
      dispatchPriority: "normal",
      requestedAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });
    const older = makeRequest("older", {
      dispatchPriority: "normal",
      requestedAt: baseTime.toISOString(),
    });

    const sorted = sortForBatchSelection([newer, older]);

    expect(sorted.map((r) => r.id)).toEqual(["older", "newer"]);
  });

  it("does not mutate the input array", () => {
    const requests = [makeRequest("b"), makeRequest("a")];
    const original = [...requests];
    sortForBatchSelection(requests);
    expect(requests).toEqual(original);
  });

  it("places escalated (override rank 0) requests ahead within the same priority", () => {
    const escalated = makeRequest("escalated", { dispatchOverrideRank: 0, requestedAt: new Date(baseTime.getTime() + 60_000).toISOString() });
    const older = makeRequest("older", { requestedAt: baseTime.toISOString() });
    const newer = makeRequest("newer", { requestedAt: new Date(baseTime.getTime() + 120_000).toISOString() });

    const sorted = sortForBatchSelection([newer, escalated, older]);
    expect(sorted.map((r) => r.id)).toEqual(["escalated", "older", "newer"]);
  });

  it("orders multiple escalated requests at the same priority by oldest requested first", () => {
    const older = makeRequest("older-escalated", {
      dispatchOverrideRank: 0,
      requestedAt: baseTime.toISOString(),
    });
    const newer = makeRequest("newer-escalated", {
      dispatchOverrideRank: 0,
      requestedAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });

    const sorted = sortForBatchSelection([newer, older]);
    expect(sorted.map((r) => r.id)).toEqual(["older-escalated", "newer-escalated"]);
  });

  it("puts an escalated newer request ahead of a non-escalated older request at the same priority", () => {
    const nonEscalated = makeRequest("non-escalated-older", { requestedAt: baseTime.toISOString() });
    const escalated = makeRequest("escalated-newer", {
      dispatchOverrideRank: 0,
      requestedAt: new Date(baseTime.getTime() + 60_000).toISOString(),
    });

    const sorted = sortForBatchSelection([nonEscalated, escalated]);
    expect(sorted.map((r) => r.id)).toEqual(["escalated-newer", "non-escalated-older"]);
  });

  it("keeps priority dominant over escalation (critical non-escalated before normal escalated)", () => {
    const normalEscalated = makeRequest("normal-escalated", {
      dispatchPriority: "normal",
      dispatchOverrideRank: 0,
      requestedAt: baseTime.toISOString(),
    });
    const criticalNonEscalated = makeRequest("critical-non-escalated", {
      dispatchPriority: "critical",
      dispatchOverrideRank: null,
      requestedAt: new Date(baseTime.getTime() + 120_000).toISOString(),
    });

    const sorted = sortForBatchSelection([normalEscalated, criticalNonEscalated]);
    expect(sorted.map((r) => r.id)).toEqual(["critical-non-escalated", "normal-escalated"]);
  });
});

describe("validateBatchSelection", () => {
  const driverId = "driver-1";
  const otherDriverId = "driver-2";

  it("reports NO_REQUESTS_SELECTED for an empty selection", () => {
    const issues = validateBatchSelection([], [], driverId, new Set());
    expect(issues).toEqual([{ code: "NO_REQUESTS_SELECTED" }]);
  });

  it("reports TOO_MANY_REQUESTS beyond the technical safety bound", () => {
    const ids = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => `req-${i}`);
    const snapshots = ids.map((id) => snapshotFromRequest(makeRequest(id)));

    const issues = validateBatchSelection(ids, snapshots, driverId, new Set());

    expect(issues).toContainEqual({ code: "TOO_MANY_REQUESTS", limit: MAX_BATCH_SIZE });
  });

  it("reports DUPLICATE_REQUEST_ID for a repeated selection", () => {
    const snapshots = [snapshotFromRequest(makeRequest("req-1"))];
    const issues = validateBatchSelection(["req-1", "req-1"], snapshots, driverId, new Set());
    expect(issues).toContainEqual({ code: "DUPLICATE_REQUEST_ID", requestId: "req-1" });
  });

  it("reports REQUEST_NOT_FOUND for a request missing from the snapshots", () => {
    const issues = validateBatchSelection(["req-missing"], [], driverId, new Set());
    expect(issues).toEqual([{ code: "REQUEST_NOT_FOUND", requestId: "req-missing" }]);
  });

  it("reports REQUEST_NOT_ELIGIBLE for a request already claimed by someone else (the race scenario)", () => {
    // Simulates the request changing state (e.g. claimed by another
    // driver) between the dispatcher's review and confirmation.
    const claimed = makeRequest("req-1", { status: "claimed", assignedDriverId: "driver-9" });
    const issues = validateBatchSelection(
      ["req-1"],
      [snapshotFromRequest(claimed)],
      driverId,
      new Set(),
    );
    expect(issues).toEqual([{ code: "REQUEST_NOT_ELIGIBLE", requestId: "req-1", status: "claimed" }]);
  });

  it("reports REQUEST_NOT_ELIGIBLE for a cancelled request", () => {
    const cancelled = makeRequest("req-1", { status: "cancelled" });
    const issues = validateBatchSelection(
      ["req-1"],
      [snapshotFromRequest(cancelled)],
      driverId,
      new Set(),
    );
    expect(issues).toEqual([{ code: "REQUEST_NOT_ELIGIBLE", requestId: "req-1", status: "cancelled" }]);
  });

  it("accepts every BATCH_ELIGIBLE_STATUSES value with no assigned driver", () => {
    for (const status of BATCH_ELIGIBLE_STATUSES) {
      const req = makeRequest("req-1", { status, assignedDriverId: null });
      const issues = validateBatchSelection(
        ["req-1"],
        [snapshotFromRequest(req)],
        driverId,
        new Set(),
      );
      expect(issues).toEqual([]);
    }
  });

  it("requires acknowledgment when a hold is addressed to a DIFFERENT preferred driver", () => {
    const held = makeRequest("req-1", {
      status: "preferred_driver_hold",
      preferredDriverId: otherDriverId,
    });
    const issues = validateBatchSelection(
      ["req-1"],
      [snapshotFromRequest(held)],
      driverId,
      new Set(),
    );
    expect(issues).toEqual([
      { code: "PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED", requestId: "req-1", preferredDriverId: otherDriverId },
    ]);
  });

  it("passes once the override is explicitly acknowledged", () => {
    const held = makeRequest("req-1", {
      status: "preferred_driver_hold",
      preferredDriverId: otherDriverId,
    });
    const issues = validateBatchSelection(
      ["req-1"],
      [snapshotFromRequest(held)],
      driverId,
      new Set(["req-1"]),
    );
    expect(issues).toEqual([]);
  });

  it("never requires acknowledgment when the hold is addressed to the SAME driver", () => {
    const held = makeRequest("req-1", {
      status: "preferred_driver_hold",
      preferredDriverId: driverId,
    });
    const issues = validateBatchSelection(
      ["req-1"],
      [snapshotFromRequest(held)],
      driverId,
      new Set(),
    );
    expect(issues).toEqual([]);
  });
});

describe("computeDispatchBatchStatus", () => {
  it("is active while any member is still claimed", () => {
    expect(computeDispatchBatchStatus(["claimed", "delivered", "confirmed"])).toBe("active");
  });

  it("is completed once no member remains claimed", () => {
    expect(computeDispatchBatchStatus(["delivered", "confirmed", "disputed"])).toBe("completed");
  });

  it("is completed for an empty member set (all left the batch)", () => {
    expect(computeDispatchBatchStatus([])).toBe("completed");
  });
});

describe("deriveRunState", () => {
  it("is in_progress when any member is still claimed (single request, single load)", () => {
    const result = deriveRunState([{ loads: 1, status: "claimed" }]);
    expect(result.derivedState).toBe("in_progress");
    expect(result.totalLoads).toBe(1);
    expect(result.loadsDelivered).toBe(0);
  });

  it("is in_progress for a partially delivered run with mixed loads", () => {
    const result = deriveRunState([
      { loads: 2, status: "delivered" },
      { loads: 1, status: "claimed" },
      { loads: 1, status: "confirmed" },
    ]);
    expect(result.derivedState).toBe("in_progress");
    expect(result.totalLoads).toBe(4);
    expect(result.loadsDelivered).toBe(3);
  });

  it("is all_delivered when no member is claimed but some are awaiting confirmation", () => {
    const result = deriveRunState([
      { loads: 2, status: "delivered" },
      { loads: 1, status: "confirmed" },
    ]);
    expect(result.derivedState).toBe("all_delivered");
    expect(result.totalLoads).toBe(3);
    expect(result.loadsDelivered).toBe(3);
  });

  it("is completed when every member is confirmed or disputed", () => {
    const result = deriveRunState([
      { loads: 1, status: "confirmed" },
      { loads: 2, status: "disputed" },
    ]);
    expect(result.derivedState).toBe("completed");
    expect(result.totalLoads).toBe(3);
    expect(result.loadsDelivered).toBe(3);
  });

  it("is completed for an empty member set (all requests removed)", () => {
    const result = deriveRunState([]);
    expect(result.derivedState).toBe("completed");
    expect(result.totalLoads).toBe(0);
    expect(result.loadsDelivered).toBe(0);
  });

  it("does not count cancelled requests as delivered loads", () => {
    const result = deriveRunState([
      { loads: 1, status: "confirmed" },
      { loads: 1, status: "cancelled" },
    ]);
    expect(result.derivedState).toBe("completed");
    expect(result.totalLoads).toBe(2);
    expect(result.loadsDelivered).toBe(1);
  });

  it("is completed when all are confirmed — run is not stuck by pending confirmation", () => {
    const result = deriveRunState([
      { loads: 1, status: "confirmed" },
      { loads: 1, status: "confirmed" },
    ]);
    expect(result.derivedState).toBe("completed");
    expect(result.totalLoads).toBe(2);
    expect(result.loadsDelivered).toBe(2);
  });

  it("handles a run with a mix of one-load and two-load requests", () => {
    const result = deriveRunState([
      { loads: 1, status: "claimed" },
      { loads: 2, status: "delivered" },
      { loads: 1, status: "confirmed" },
    ]);
    expect(result.derivedState).toBe("in_progress");
    expect(result.totalLoads).toBe(4);
    expect(result.loadsDelivered).toBe(3);
  });

  it("correctly computes all_delivered with a single disputed request", () => {
    const result = deriveRunState([
      { loads: 1, status: "delivered" },
      { loads: 1, status: "disputed" },
    ]);
    expect(result.derivedState).toBe("all_delivered");
    expect(result.loadsDelivered).toBe(2);
  });

  it("customer confirmation pending after physical delivery does not keep run active", () => {
    // This is a key requirement: physical delivery is done, resident
    // has not confirmed, but the driver should NOT appear busy.
    const result = deriveRunState([
      { loads: 2, status: "delivered" },
      { loads: 1, status: "delivered" },
    ]);
    expect(result.derivedState).toBe("all_delivered");
    expect(result.totalLoads).toBe(3);
    expect(result.loadsDelivered).toBe(3);
    // Not "in_progress" — driver is operationally free.
  });
});
