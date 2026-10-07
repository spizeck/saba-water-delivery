import { describe, expect, it } from "vitest";

import type { WaterRequest } from "@/lib/domain/types";

import {
  RECENT_RESOLVED_LIMIT,
  selectActiveRequests,
  selectRecentResolved,
} from "../recentResolved";

const baseRequest = {
  customerId: null,
  customer: { displayName: "Customer" },
  source: "resident" as const,
  createdBy: null,
  loads: 1 as const,
  gallons: 1000 as const,
  village: "Windwardside",
  deliveryDirections: "",
  requestNotes: null,
  preferredDriverId: null,
  preferredDriverExpiresAt: null,
  assignedDriverId: null,
  waterSituation: null,
  attestationAccepted: true,
  attestationAcceptedAt: null,
  dispatchPriority: "normal" as const,
  prioritySource: "system" as const,
  priorityReason: null,
  priorityUpdatedBy: null,
  priorityUpdatedAt: null,
  requestedAt: "2024-01-01T00:00:00.000Z",
  availableAt: null,
  claimedAt: null,
  deliveredAt: null,
  confirmedAt: null,
  cancelledAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  dispatchBatchId: null,
  batchSequence: null,
  dispatchOverrideRank: null,
  loadCollections: null,
} as const;

function makeRequest(overrides: Partial<WaterRequest>): WaterRequest {
  return { ...baseRequest, ...overrides } as WaterRequest;
}

function confirmed(id: string, confirmedAt: string, requestedAt?: string) {
  return makeRequest({
    id,
    status: "confirmed",
    confirmedAt,
    ...(requestedAt ? { requestedAt } : {}),
  });
}

function cancelled(id: string, cancelledAt: string, requestedAt?: string) {
  return makeRequest({
    id,
    status: "cancelled",
    cancelledAt,
    ...(requestedAt ? { requestedAt } : {}),
  });
}

describe("selectRecentResolved", () => {
  it("orders by resolution time, not request creation time", () => {
    // req-old was REQUESTED long ago but resolved just now; req-new was
    // requested recently but resolved days ago. The dispatcher queue
    // ordering (requestedAt) would rank req-new first — resolution
    // ordering must rank req-old first.
    const requests = [
      confirmed(
        "req-new",
        "2024-06-02T00:00:00.000Z",
        "2024-06-01T00:00:00.000Z",
      ),
      confirmed(
        "req-old",
        "2024-06-10T00:00:00.000Z",
        "2024-01-01T00:00:00.000Z",
      ),
    ];
    expect(selectRecentResolved(requests).map((r) => r.id)).toEqual([
      "req-old",
      "req-new",
    ]);
  });

  it("surfaces a newly confirmed older request above an older confirmation", () => {
    const requests = [
      confirmed("confirmed-earlier", "2024-06-01T08:00:00.000Z"),
      confirmed(
        "confirmed-now",
        "2024-06-10T08:00:00.000Z",
        "2023-12-01T00:00:00.000Z",
      ),
    ];
    expect(selectRecentResolved(requests)[0].id).toBe("confirmed-now");
  });

  it("interleaves confirmed and cancelled by actual resolution time", () => {
    const requests = [
      confirmed("c1", "2024-06-10T10:00:00.000Z"),
      cancelled("x1", "2024-06-10T12:00:00.000Z"),
      confirmed("c2", "2024-06-10T14:00:00.000Z"),
      cancelled("x2", "2024-06-10T16:00:00.000Z"),
    ];
    expect(selectRecentResolved(requests).map((r) => r.id)).toEqual([
      "x2",
      "c2",
      "x1",
      "c1",
    ]);
  });

  it("limits to the 20 most recently resolved", () => {
    const requests = Array.from({ length: 25 }, (_, i) =>
      // Resolution order is deliberately decoupled from requestedAt:
      // every request was created on the same day, resolved i minutes
      // apart on a later day.
      confirmed(
        `req-${String(i).padStart(2, "0")}`,
        new Date(
          Date.parse("2024-06-10T00:00:00.000Z") + i * 60_000,
        ).toISOString(),
        "2024-01-01T00:00:00.000Z",
      ),
    );
    const result = selectRecentResolved(requests);
    expect(result).toHaveLength(RECENT_RESOLVED_LIMIT);
    // The five oldest-resolved are dropped; the newest resolution is first.
    expect(result[0].id).toBe("req-24");
    expect(result.map((r) => r.id)).not.toContain("req-04");
  });

  it("falls back to updatedAt for legacy cancelled records without cancelledAt", () => {
    const legacy = makeRequest({
      id: "legacy-cancelled",
      status: "cancelled",
      cancelledAt: null,
      updatedAt: "2024-06-05T00:00:00.000Z",
    });
    const newer = cancelled("new-cancelled", "2024-06-10T00:00:00.000Z");
    const older = confirmed("old-confirmed", "2024-06-01T00:00:00.000Z");
    expect(
      selectRecentResolved([older, legacy, newer]).map((r) => r.id),
    ).toEqual(["new-cancelled", "legacy-cancelled", "old-confirmed"]);
  });

  it("breaks identical resolution timestamps deterministically by id", () => {
    const ts = "2024-06-10T00:00:00.000Z";
    const a = confirmed("req-b", ts);
    const b = confirmed("req-a", ts);
    expect(selectRecentResolved([a, b]).map((r) => r.id)).toEqual([
      "req-a",
      "req-b",
    ]);
    expect(selectRecentResolved([b, a]).map((r) => r.id)).toEqual([
      "req-a",
      "req-b",
    ]);
  });

  it("excludes unresolved statuses — delivered and disputed stay active", () => {
    const requests = [
      makeRequest({ id: "d1", status: "delivered" }),
      makeRequest({ id: "p1", status: "disputed" }),
      makeRequest({ id: "a1", status: "available" }),
      makeRequest({ id: "c1", status: "claimed" }),
      confirmed("done", "2024-06-10T00:00:00.000Z"),
    ];
    expect(selectRecentResolved(requests).map((r) => r.id)).toEqual(["done"]);
  });

  it("does not mutate the input array", () => {
    const requests = [
      confirmed("a", "2024-06-01T00:00:00.000Z"),
      confirmed("b", "2024-06-10T00:00:00.000Z"),
      makeRequest({ id: "active", status: "available" }),
    ];
    const before = [...requests];
    selectRecentResolved(requests);
    expect(requests).toEqual(before);
  });
});

describe("selectActiveRequests", () => {
  it("preserves the caller's operational queue order exactly", () => {
    // Mirrors page.tsx ordering inputs: resolved records are simply
    // removed; active records keep their incoming positions untouched.
    const requests = [
      makeRequest({ id: "disputed-1", status: "disputed" }),
      makeRequest({ id: "delivered-1", status: "delivered" }),
      confirmed("confirmed-1", "2024-06-10T00:00:00.000Z"),
      makeRequest({ id: "available-1", status: "available" }),
      cancelled("cancelled-1", "2024-06-11T00:00:00.000Z"),
      makeRequest({ id: "claimed-1", status: "claimed" }),
      makeRequest({ id: "requested-1", status: "requested" }),
    ];
    expect(selectActiveRequests(requests).map((r) => r.id)).toEqual([
      "disputed-1",
      "delivered-1",
      "available-1",
      "claimed-1",
      "requested-1",
    ]);
  });
});
