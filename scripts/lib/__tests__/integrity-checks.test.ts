import { describe, expect, it } from "vitest";

import { runIntegrityChecks } from "../recovery-checks.mjs";

/**
 * Tests for the production integrity check set (issue #52). Synthetic data only
 * (no Firestore, no production data, no PII). Covers the representative bad
 * states #52 requires AND the valid/complex states that must NOT be flagged.
 */

/** A fully consistent snapshot exercising several valid complex states. */
function validSnapshot() {
  return {
    drivers: [
      // normal driver holding one self-claimed request
      {
        id: "reg-1",
        linkedUserId: "driver-1",
        activeRequestId: "req-1",
        archivedAt: null,
      },
      // delivery-run driver: activeRequestId deliberately null (ADR 0008)
      {
        id: "reg-2",
        linkedUserId: "driver-2",
        activeRequestId: null,
        archivedAt: null,
      },
    ],
    users: [
      { uid: "driver-1", roles: ["resident", "driver"] },
      { uid: "driver-2", roles: ["resident", "driver"] },
      { uid: "resident-1", roles: ["resident"] },
    ],
    batches: [
      {
        id: "batch-1",
        driverId: "driver-2",
        originalRequestIds: ["req-2", "req-3"],
        status: "active",
      },
      {
        id: "batch-2",
        driverId: "driver-2",
        originalRequestIds: ["req-4"],
        status: "completed",
      },
    ],
    requests: [
      // normal claimed with matching back-pointer
      {
        id: "req-1",
        status: "claimed",
        assignedDriverId: "driver-1",
        customerId: "resident-1",
        dispatchBatchId: null,
        preferredDriverId: null,
      },
      // active delivery-run members
      {
        id: "req-2",
        status: "claimed",
        assignedDriverId: "driver-2",
        customerId: null,
        dispatchBatchId: "batch-1",
        preferredDriverId: null,
      },
      {
        id: "req-3",
        status: "claimed",
        assignedDriverId: "driver-2",
        customerId: null,
        dispatchBatchId: "batch-1",
        preferredDriverId: null,
      },
      // terminal member that legitimately keeps its dispatchBatchId
      {
        id: "req-4",
        status: "confirmed",
        assignedDriverId: "driver-2",
        customerId: null,
        dispatchBatchId: "batch-2",
        preferredDriverId: null,
      },
      // valid preferred-driver hold (driver may be offline — not flagged)
      {
        id: "req-5",
        status: "preferred_driver_hold",
        assignedDriverId: null,
        customerId: null,
        dispatchBatchId: null,
        preferredDriverId: "driver-1",
      },
      // intentionally unregistered request — customerId null is NOT an orphan
      {
        id: "req-6",
        status: "available",
        assignedDriverId: null,
        customerId: null,
        dispatchBatchId: null,
        preferredDriverId: null,
      },
    ],
  };
}

const codes = (findings: Array<{ code: string }>) =>
  findings.map((f) => f.code);

describe("runIntegrityChecks — valid states are not flagged", () => {
  it("reports no findings for a fully consistent snapshot", () => {
    const { findings, summary } = runIntegrityChecks(validSnapshot());
    expect(findings).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.bySeverity).toEqual({ critical: 0, warning: 0, info: 0 });
  });
});

describe("driver-registry active assignment (#1) & claimed ownership (#2)", () => {
  it("flags a stale activeRequestId (missing/terminal/reassigned) as warning", () => {
    const snap = validSnapshot();
    snap.drivers[0].activeRequestId = "gone";
    const { findings } = runIntegrityChecks(snap);
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "stale_driver_lock",
        code: "stale_driver_lock.request_missing",
        severity: "warning",
        id: "reg-1",
      }),
    );
  });

  it("flags a claimed request assigned to a missing driver as critical", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-x",
          status: "claimed",
          assignedDriverId: "ghost",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "claimed_ownership.driver_registry_missing",
        severity: "critical",
        id: "req-x",
      }),
    );
  });

  it("flags a claimed request assigned to an archived driver as critical", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-9",
          linkedUserId: "driver-9",
          activeRequestId: "req-x",
          archivedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      requests: [
        {
          id: "req-x",
          status: "claimed",
          assignedDriverId: "driver-9",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
    });
    expect(codes(findings)).toContain("claimed_ownership.driver_archived");
  });
});

describe("delivery-run membership both directions (#3, #4)", () => {
  it("flags a request whose dispatchBatchId is absent from the batch originalRequestIds (critical)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-2",
          linkedUserId: "driver-2",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["other"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "driver-2",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "batch_ownership.member_not_in_original",
        severity: "critical",
        id: "req-2",
        relatedIds: ["batch-1"],
      }),
    );
  });

  it("flags a batch member whose driver differs from the run driver (critical)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-2",
          linkedUserId: "driver-2",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "someone-else",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
    });
    expect(codes(findings)).toContain("batch_ownership.driver_mismatch");
  });

  it("flags a batch whose cached status disagrees with its members (warning)", () => {
    const { findings } = runIntegrityChecks({
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "confirmed", // no claimed members -> derived "completed"
          assignedDriverId: "driver-2",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
      drivers: [
        {
          id: "reg-2",
          linkedUserId: "driver-2",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "driver-2", roles: ["resident", "driver"] }],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        category: "batch_status_drift",
        severity: "warning",
        id: "batch-1",
      }),
    );
  });

  it("detects batch->missing request and request->missing batch", () => {
    const { findings } = runIntegrityChecks({
      batches: [
        { id: "batch-1", originalRequestIds: ["gone"], status: "active" },
      ],
      requests: [
        {
          id: "req-9",
          status: "available",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: "no-batch",
        },
      ],
    });
    expect(codes(findings)).toContain(
      "batch_membership.original_request_missing",
    );
    expect(codes(findings)).toContain("batch_membership.batch_missing");
  });
});

describe("batch-member driver invariant (#3, strengthened)", () => {
  // Domain-verified (createDispatchBatch / dispatcherReassign / cancel /
  // dispute-reopen in waterRequests.ts): a CURRENT batch member always has both
  // batch.driverId and its own assignedDriverId set and equal. All three broken
  // forms are impossible, delivery-misdirecting states → critical.
  const driver2 = {
    id: "reg-2",
    linkedUserId: "driver-2",
    activeRequestId: null,
    archivedAt: null,
  };

  it("flags a current member whose batch has no driverId (critical)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [driver2],
      batches: [
        {
          id: "batch-1",
          driverId: null,
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "driver-2",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "batch_ownership.batch_missing_driver",
        severity: "critical",
        id: "req-2",
        relatedIds: ["batch-1"],
      }),
    );
  });

  it("flags a current member with no assignedDriverId (critical)", () => {
    const { findings } = runIntegrityChecks({
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          // terminal member (not "claimed") so this isolates the batch check
          // from the separate claimed-ownership.no_driver rule
          id: "req-2",
          status: "confirmed",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "batch_ownership.member_missing_driver",
        severity: "critical",
        id: "req-2",
        relatedIds: ["batch-1"],
      }),
    );
  });

  it("flags a current member whose driver differs from the run driver (critical)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [driver2],
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "someone-else",
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "batch_ownership.driver_mismatch",
        severity: "critical",
        id: "req-2",
      }),
    );
  });

  it("does NOT flag a valid current member assigned to the run driver", () => {
    const { findings } = runIntegrityChecks({
      drivers: [driver2],
      users: [{ uid: "driver-2", roles: ["resident", "driver"] }],
      batches: [
        {
          id: "batch-1",
          driverId: "driver-2",
          originalRequestIds: ["req-2"],
          status: "active",
        },
      ],
      requests: [
        {
          id: "req-2",
          status: "claimed",
          assignedDriverId: "driver-2",
          customerId: null,
          dispatchBatchId: "batch-1",
          preferredDriverId: null,
        },
      ],
    });
    expect(
      findings.filter((f) => f.category === "batch_member_driver_mismatch"),
    ).toEqual([]);
  });
});

describe("bounded-scan budget: not-scanned is never reported as missing (#52)", () => {
  it("does NOT flag referenced ids left unscanned by the record budget as missing", () => {
    const input = {
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "d1",
          activeRequestId: "unread-req",
          archivedAt: null,
        },
      ],
      users: [{ uid: "d1", roles: ["resident", "driver"] }],
      batches: [
        {
          id: "b1",
          driverId: "d1",
          originalRequestIds: ["unread-req", "also-unread"],
          status: "active",
        },
      ],
      requests: [], // neither referenced request was scanned
    };

    // Without the unresolved set, both references look genuinely missing.
    const naive = runIntegrityChecks(input);
    expect(codes(naive.findings)).toContain(
      "stale_driver_lock.request_missing",
    );
    expect(codes(naive.findings)).toContain(
      "batch_membership.original_request_missing",
    );

    // Marked unresolved-by-budget, neither missing finding fires — and the
    // batch's status drift is suppressed too, since its member set is unknown.
    const guarded = runIntegrityChecks(input, {
      unresolvedRequestIds: ["unread-req", "also-unread"],
    });
    expect(guarded.findings).toEqual([]);
  });
});

describe("resident/request ownership (#4/#5)", () => {
  it("flags a registered request whose owner user is missing (warning)", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-1",
          status: "available",
          assignedDriverId: null,
          customerId: "deleted-user",
          dispatchBatchId: null,
        },
      ],
    });
    expect(codes(findings)).toContain("resident_ownership.user_missing");
  });

  it("does NOT flag an intentionally unregistered (customerId null) request", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-1",
          status: "available",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: null,
        },
      ],
    });
    expect(
      findings.filter((f) => f.category === "orphaned_request_owner"),
    ).toEqual([]);
  });
});

describe("preferred-driver integrity (#5)", () => {
  it("flags a hold whose preferred driver has no registry entry (warning)", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-1",
          status: "preferred_driver_hold",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: null,
          preferredDriverId: "ghost",
        },
      ],
    });
    expect(codes(findings)).toContain("preferred_driver.no_registry");
  });

  it("flags a hold whose preferred driver registry is archived (warning)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "driver-1",
          activeRequestId: null,
          archivedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      users: [{ uid: "driver-1", roles: ["resident", "driver"] }],
      requests: [
        {
          id: "req-1",
          status: "preferred_driver_hold",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: null,
          preferredDriverId: "driver-1",
        },
      ],
    });
    expect(codes(findings)).toContain("preferred_driver.archived");
  });

  it("does NOT flag a valid preferred-driver hold (driver present, possibly offline)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "driver-1",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "driver-1", roles: ["resident", "driver"] }],
      requests: [
        {
          id: "req-1",
          status: "preferred_driver_hold",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: null,
          preferredDriverId: "driver-1",
        },
      ],
    });
    expect(
      findings.filter((f) => f.category.startsWith("preferred_driver")),
    ).toEqual([]);
  });
});

describe("user role <-> driver registry linkage (#6)", () => {
  it("flags a registry linked to a missing user (warning)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "gone",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
    });
    expect(codes(findings)).toContain("role_registry.linked_user_missing");
  });

  it("flags a registry linked to a user lacking the driver role (warning)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "user-1",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "user-1", roles: ["resident"] }],
    });
    expect(codes(findings)).toContain(
      "role_registry.linked_user_missing_driver_role",
    );
  });

  it("flags a user with the driver role but no registry link (warning)", () => {
    const { findings } = runIntegrityChecks({
      users: [{ uid: "user-1", roles: ["resident", "driver"] }],
    });
    expect(codes(findings)).toContain(
      "role_registry.driver_role_without_registry",
    );
  });

  it("flags two live registry entries linked to the same user (warning)", () => {
    const { findings } = runIntegrityChecks({
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "user-1",
          activeRequestId: null,
          archivedAt: null,
        },
        {
          id: "reg-2",
          linkedUserId: "user-1",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "user-1", roles: ["resident", "driver"] }],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "role_registry.duplicate_link",
        id: "user-1",
      }),
    );
  });
});

describe("request-state invariants (#7)", () => {
  it("flags a pre-claim request that still carries an assignedDriverId (warning)", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-1",
          status: "available",
          assignedDriverId: "driver-1",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "driver-1",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "driver-1", roles: ["resident", "driver"] }],
    });
    expect(codes(findings)).toContain("request_state.preclaim_with_assignment");
  });

  it("flags a cancelled request that still carries a dispatchBatchId (warning)", () => {
    const { findings } = runIntegrityChecks({
      requests: [
        {
          id: "req-1",
          status: "cancelled",
          assignedDriverId: null,
          customerId: null,
          dispatchBatchId: "batch-1",
        },
      ],
      batches: [
        {
          id: "batch-1",
          driverId: "driver-1",
          originalRequestIds: ["req-1"],
          status: "completed",
        },
      ],
    });
    expect(codes(findings)).toContain("request_state.cancelled_with_batch");
  });
});

describe("account-merge reconciliation integrity (#73)", () => {
  const NOW = Date.UTC(2026, 5, 1, 0, 0, 0);
  const fresh = new Date(NOW - 60_000).toISOString();
  const stale = new Date(NOW - 48 * 3_600_000).toISOString();

  function mergeEvent(overrides = {}) {
    return {
      id: "merge-1",
      canonicalUserId: "canon",
      duplicateUserId: "dup",
      duplicateAuthDeleted: true,
      createdAt: fresh,
      authReconciliation: { state: "reconciled" },
      ...overrides,
    };
  }

  it("does not flag a healthy reconciled merge or fresh pending work", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          mergeEvent(),
          mergeEvent({
            id: "merge-2",
            duplicateAuthDeleted: false,
            authReconciliation: { state: "pending" },
          }),
        ],
      },
      { nowMs: NOW },
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a terminally failed reconciliation as actionable", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          mergeEvent({
            duplicateAuthDeleted: false,
            authReconciliation: {
              state: "failed",
              lastFailureCategory: "max_attempts",
            },
          }),
        ],
      },
      { nowMs: NOW },
    );
    expect(codes(findings)).toContain("merge_reconciliation.terminal_failure");
  });

  it("flags reconciliation unresolved beyond the stale horizon", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          // Legacy record: no authReconciliation sub-record at all.
          mergeEvent({
            duplicateAuthDeleted: false,
            createdAt: stale,
            authReconciliation: null,
          }),
        ],
      },
      { nowMs: NOW },
    );
    expect(codes(findings)).toContain("merge_reconciliation.unresolved_stale");
  });

  it("flags a malformed merge record as critical", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          mergeEvent({
            duplicateAuthDeleted: false,
            canonicalUserId: "same",
            duplicateUserId: "same",
          }),
        ],
      },
      { nowMs: NOW },
    );
    const f = findings.find(
      (x) => x.code === "merge_reconciliation.malformed_record",
    );
    expect(f?.severity).toBe("critical");
  });

  it("flags inconsistent terminal combinations both ways", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          mergeEvent({
            id: "a",
            authReconciliation: { state: "pending" }, // flag set, state not
          }),
          mergeEvent({
            id: "b",
            duplicateAuthDeleted: false,
            authReconciliation: { state: "reconciled" }, // state set, flag not
          }),
        ],
      },
      { nowMs: NOW },
    );
    expect(codes(findings)).toContain(
      "merge_reconciliation.deleted_flag_without_reconciled_state",
    );
    expect(codes(findings)).toContain(
      "merge_reconciliation.reconciled_state_without_deleted_flag",
    );
  });

  it("reports an expired processing lease as informational (auto-recovered)", () => {
    const { findings } = runIntegrityChecks(
      {
        mergeEvents: [
          mergeEvent({
            duplicateAuthDeleted: false,
            authReconciliation: {
              state: "processing",
              leaseExpiresAt: NOW - 1_000,
            },
          }),
        ],
      },
      { nowMs: NOW },
    );
    const f = findings.find(
      (x) => x.code === "merge_reconciliation.stale_lease",
    );
    expect(f?.severity).toBe("info");
  });

  it("flags a merged-away marker whose canonical user is missing, and a request still owned by a merged identity", () => {
    const { findings } = runIntegrityChecks(
      {
        users: [{ uid: "dup", roles: ["resident"], mergedIntoUserId: "ghost" }],
        requests: [
          {
            id: "req-1",
            status: "available",
            customerId: "dup",
            assignedDriverId: null,
            dispatchBatchId: null,
          },
        ],
      },
      { nowMs: NOW },
    );
    expect(codes(findings)).toContain("merge_marker.canonical_missing");
    expect(codes(findings)).toContain(
      "merge_marker.request_owned_by_merged_user",
    );
  });
});

describe("severity model", () => {
  it("summarizes by severity and category and orders critical first", () => {
    const { findings, summary } = runIntegrityChecks({
      requests: [
        {
          id: "req-x",
          status: "claimed",
          assignedDriverId: "ghost",
          customerId: null,
          dispatchBatchId: null,
        },
        {
          id: "req-y",
          status: "available",
          assignedDriverId: "driver-1",
          customerId: null,
          dispatchBatchId: null,
        },
      ],
      drivers: [
        {
          id: "reg-1",
          linkedUserId: "driver-1",
          activeRequestId: null,
          archivedAt: null,
        },
      ],
      users: [{ uid: "driver-1", roles: ["resident", "driver"] }],
    });
    expect(summary.bySeverity.critical).toBeGreaterThanOrEqual(1);
    expect(summary.bySeverity.warning).toBeGreaterThanOrEqual(1);
    // Critical findings are ordered before warnings.
    expect(findings[0].severity).toBe("critical");
  });
});
