import { describe, expect, it } from "vitest";

import { classifyDriverLock, runRecoveryChecks } from "../recovery-checks.mjs";

/**
 * Tests for the read-only disaster-recovery validation logic (issue #35).
 * Exercises the representative inconsistent states a restore could introduce,
 * using synthetic data only (no Firestore, no production data, no PII).
 */

describe("classifyDriverLock", () => {
  it("treats a claimed request assigned to the same driver as valid", () => {
    expect(
      classifyDriverLock("driver-1", {
        status: "claimed",
        assignedDriverId: "driver-1",
      }),
    ).toBeNull();
  });

  it("flags a missing referenced request", () => {
    expect(classifyDriverLock("driver-1", undefined)).toBe("request_missing");
    expect(classifyDriverLock("driver-1", null)).toBe("request_missing");
  });

  it("flags a request reassigned to another driver", () => {
    expect(
      classifyDriverLock("driver-1", {
        status: "claimed",
        assignedDriverId: "driver-2",
      }),
    ).toBe("reassigned");
  });

  it("flags a request that has left claimed (delivered/confirmed/etc.)", () => {
    for (const status of ["delivered", "confirmed", "cancelled", "disputed"]) {
      expect(
        classifyDriverLock("driver-1", {
          status,
          assignedDriverId: "driver-1",
        }),
      ).toBe(status);
    }
    expect(
      classifyDriverLock("driver-1", {
        status: "available",
        assignedDriverId: "driver-1",
      }),
    ).toBe("not_active");
  });
});

describe("runRecoveryChecks", () => {
  it("reports no findings for a fully consistent snapshot", () => {
    const { findings, summary } = runRecoveryChecks({
      drivers: [
        { id: "reg-1", linkedUserId: "driver-1", activeRequestId: "req-1" },
      ],
      requests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "driver-1",
          customerId: "resident-1",
          dispatchBatchId: null,
        },
      ],
      batches: [],
      users: [{ uid: "resident-1" }, { uid: "driver-1" }],
    });
    expect(findings).toEqual([]);
    expect(summary.total).toBe(0);
  });

  it("detects a stale activeRequestId (referenced request missing)", () => {
    const { findings } = runRecoveryChecks({
      drivers: [
        { id: "reg-1", linkedUserId: "driver-1", activeRequestId: "gone" },
      ],
      requests: [],
      batches: [],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ category: "stale_driver_lock", id: "reg-1" }),
    );
  });

  it("detects a claimed request assigned to the wrong driver", () => {
    // The request is claimed by driver-2, but driver-2's registry lock points
    // at a different request (a wrong/mismatched assignment).
    const { findings } = runRecoveryChecks({
      drivers: [
        { id: "reg-2", linkedUserId: "driver-2", activeRequestId: "other" },
      ],
      requests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "driver-2",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
      batches: [],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "claimed_request_driver_mismatch",
        id: "req-1",
      }),
    );
  });

  it("detects a claimed request with no matching driver registry entry", () => {
    const { findings } = runRecoveryChecks({
      drivers: [],
      requests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "ghost-driver",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
      batches: [],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "claimed_request_driver_mismatch",
        id: "req-1",
      }),
    );
  });

  it("does NOT flag a valid batch (Delivery Run) load whose driver lock differs", () => {
    // Batch dispatch deliberately leaves activeRequestId unchanged, so a
    // driver can hold several batch loads. Neither a null nor a different
    // activeRequestId is an inconsistency for a batch-claimed request.
    const { findings } = runRecoveryChecks({
      drivers: [
        { id: "reg-1", linkedUserId: "driver-1", activeRequestId: null },
      ],
      requests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "driver-1",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "driver-1",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
      batches: [
        {
          id: "batch-1",
          originalRequestIds: ["req-1", "req-2"],
          status: "active",
        },
      ],
      users: [],
    });
    expect(
      findings.filter((f) => f.category === "claimed_request_driver_mismatch"),
    ).toEqual([]);
  });

  it("still flags a batch load assigned to a non-existent driver", () => {
    const { findings } = runRecoveryChecks({
      drivers: [],
      requests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "ghost",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
      batches: [
        { id: "batch-1", originalRequestIds: ["req-1"], status: "active" },
      ],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "claimed_request_driver_mismatch",
        id: "req-1",
      }),
    );
  });

  it("detects a delivery run pointing at a missing request", () => {
    const { findings } = runRecoveryChecks({
      drivers: [],
      requests: [],
      batches: [
        {
          id: "batch-1",
          originalRequestIds: ["req-1", "req-2"],
          status: "active",
        },
      ],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "batch_missing_request",
        id: "batch-1",
      }),
    );
    // Both missing members are reported.
    expect(
      findings.filter((f) => f.category === "batch_missing_request"),
    ).toHaveLength(2);
  });

  it("detects a request pointing at a missing delivery run", () => {
    const { findings } = runRecoveryChecks({
      drivers: [],
      requests: [
        {
          id: "req-1",
          status: "available",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: "gone-batch",
        },
      ],
      batches: [],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "request_batch_missing",
        id: "req-1",
      }),
    );
  });

  it("detects an orphaned registered request owner", () => {
    const { findings } = runRecoveryChecks({
      drivers: [],
      requests: [
        {
          id: "req-1",
          status: "available",
          assignedDriverId: null,
          customerId: "deleted-user",
          dispatchBatchId: null,
        },
      ],
      batches: [],
      users: [],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "orphaned_request_owner",
        id: "req-1",
      }),
    );
  });

  it("summarizes findings by category", () => {
    const { summary } = runRecoveryChecks({
      drivers: [
        { id: "reg-1", linkedUserId: "driver-1", activeRequestId: "gone" },
      ],
      requests: [],
      batches: [
        { id: "batch-1", originalRequestIds: ["missing"], status: "active" },
      ],
      users: [],
    });
    expect(summary.byCategory.stale_driver_lock).toBe(1);
    expect(summary.byCategory.batch_missing_request).toBe(1);
    expect(summary.total).toBe(2);
  });
});
