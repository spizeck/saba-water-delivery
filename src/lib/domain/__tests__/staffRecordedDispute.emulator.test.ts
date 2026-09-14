import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  checkDeliveryConfirmationTimeout,
  confirmDeliveryByStaff,
  disputeWaterDelivery,
  getRequestEvents,
  recordCustomerDisputeByStaff,
  resolveDisputeCompleted,
  resolveDisputeReopened,
} from "@/lib/domain/waterRequests";
import { REQUEST_NOTES_MAX_LENGTH } from "@/lib/domain/requestNotes";

/**
 * Emulator-backed tests for staff-recorded disputes on unregistered
 * (dispatcher-created) requests — `recordCustomerDisputeByStaff()`
 * (issue #50).
 *
 * These tests prove the Firestore transaction enforces eligibility against
 * COMMITTED state (unregistered + staff-entered + currently "delivered"),
 * that the state change and the `customer_dispute_recorded_by_staff`
 * audit event commit atomically (issue #49 convention), that competing
 * confirmation / auto-confirmation / duplicate-dispute races resolve to
 * exactly one consistent outcome, and that the existing dispute-resolution
 * workflow accepts a staff-created dispute unchanged.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";

const DISPATCHER = "dispatcher-uid-1";
const ADMIN = "admin-uid-1";
const RESIDENT = "resident-uid-1";
const DRIVER = "driver-uid-1";

const REASON = "Customer called: says no water was delivered.";

async function clearState(): Promise<void> {
  for (const c of [REQUESTS, REGISTRY]) {
    await db.recursiveDelete(db.collection(c));
  }
}

/**
 * Seeds an UNREGISTERED (dispatcher-entered, `customerId: null`) request.
 * Defaults to the eligible state: `status: "delivered"`. Overrides are
 * applied last so tests can move the request to any other state.
 */
async function seedRequest(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await db
    .collection(REQUESTS)
    .doc(id)
    .set({
      customerId: null,
      customer: {
        displayName: "Walk-in Customer",
        phone: "+599 416 9999",
        email: null,
        isRegistered: false,
      },
      source: "dispatcher",
      createdBy: DISPATCHER,
      loads: 1,
      gallons: 1000,
      village: "Windwardside",
      deliveryDirections: "Blue gate.",
      requestNotes: null,
      preferredDriverId: null,
      preferredDriverExpiresAt: null,
      assignedDriverId: DRIVER,
      status: "delivered",
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
      claimedAt: now,
      deliveredAt: now,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
}

/** Seeds a REGISTERED resident's request (the normal resident path). */
async function seedRegisteredRequest(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await seedRequest(id, {
    customerId: RESIDENT,
    customer: {
      displayName: "Resident One",
      phone: "+599 416 0000",
      email: null,
      isRegistered: true,
    },
    source: "resident",
    createdBy: null,
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

describe("recordCustomerDisputeByStaff — happy path", () => {
  it("moves an unregistered delivered request to disputed with the staff audit event", async () => {
    await seedRequest("r1");

    const result = await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: REASON,
    });

    expect(result.status).toBe("disputed");
    const data = await requestData("r1");
    expect(data?.status).toBe("disputed");
    // The delivered timestamp is preserved — the delivery itself is not
    // erased by the dispute.
    expect(data?.deliveredAt).toBeTruthy();
    expect(data?.confirmedAt).toBeNull();

    const events = await getRequestEvents("r1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("customer_dispute_recorded_by_staff");
    expect(events[0].actorId).toBe(DISPATCHER);
    expect(events[0].actorRole).toBe("dispatcher");
    expect(events[0].metadata).toEqual({ reason: REASON });
    // Never recorded as the customer's own authenticated action.
    expect(await requestEventTypes("r1")).not.toContain("customer_disputed");
  }, 30_000);

  it("records an admin actor's real role on the audit event", async () => {
    await seedRequest("r1");

    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: ADMIN,
      actorRole: "admin",
      reason: REASON,
    });

    const events = await getRequestEvents("r1");
    expect(events[0].actorId).toBe(ADMIN);
    expect(events[0].actorRole).toBe("admin");
  }, 30_000);

  it("trims the reason before storing it", async () => {
    await seedRequest("r1");

    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: `  ${REASON}  `,
    });

    const events = await getRequestEvents("r1");
    expect(events[0].metadata).toEqual({ reason: REASON });
  }, 30_000);
});

describe("recordCustomerDisputeByStaff — reason validation", () => {
  it.each(["", "   ", "\n\t "])(
    "rejects an empty/whitespace reason (%j)",
    async (reason) => {
      await seedRequest("r1");
      await expect(
        recordCustomerDisputeByStaff({
          requestId: "r1",
          actorId: DISPATCHER,
          actorRole: "dispatcher",
          reason,
        }),
      ).rejects.toThrow("DISPUTE_REASON_REQUIRED");
      expect((await requestData("r1"))?.status).toBe("delivered");
      expect(await requestEventTypes("r1")).toHaveLength(0);
    },
    30_000,
  );

  it("rejects a reason longer than the request-notes limit", async () => {
    await seedRequest("r1");
    await expect(
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: "x".repeat(REQUEST_NOTES_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow("DISPUTE_REASON_TOO_LONG");
    expect((await requestData("r1"))?.status).toBe("delivered");
  }, 30_000);

  it("accepts a reason at exactly the limit", async () => {
    await seedRequest("r1");
    const reason = "x".repeat(REQUEST_NOTES_MAX_LENGTH);
    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason,
    });
    expect((await requestData("r1"))?.status).toBe("disputed");
  }, 30_000);
});

describe("recordCustomerDisputeByStaff — eligibility rejections", () => {
  it("rejects a registered resident's request — the resident path is canonical", async () => {
    await seedRegisteredRequest("r1");
    await expect(
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ).rejects.toThrow("REQUEST_HAS_REGISTERED_CUSTOMER");
    expect((await requestData("r1"))?.status).toBe("delivered");
    expect(await requestEventTypes("r1")).toHaveLength(0);
  }, 30_000);

  it("rejects a customerId-null request that was not staff-entered", async () => {
    // Defensive: every real customerId-null request is dispatcher-created,
    // so a null-customerId document claiming another source is anomalous
    // and must not be disputable through this path.
    await seedRequest("r1", { source: "resident" });
    await expect(
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ).rejects.toThrow("REQUEST_NOT_UNREGISTERED");
    expect((await requestData("r1"))?.status).toBe("delivered");
  }, 30_000);

  it.each([
    "requested",
    "preferred_driver_hold",
    "available",
    "claimed",
    "confirmed",
    "disputed",
    "cancelled",
  ] as const)(
    "rejects a %s request — only delivered/unconfirmed is eligible",
    async (status) => {
      await seedRequest("r1", {
        status,
        confirmedAt: status === "confirmed" ? new Date() : null,
        assignedDriverId: status === "claimed" ? DRIVER : null,
      });
      await expect(
        recordCustomerDisputeByStaff({
          requestId: "r1",
          actorId: DISPATCHER,
          actorRole: "dispatcher",
          reason: REASON,
        }),
      ).rejects.toThrow("INVALID_STATUS_FOR_DISPUTE");
      expect((await requestData("r1"))?.status).toBe(status);
      expect(await requestEventTypes("r1")).toHaveLength(0);
    },
    30_000,
  );

  it("rejects a missing request", async () => {
    await expect(
      recordCustomerDisputeByStaff({
        requestId: "nope",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ).rejects.toThrow("REQUEST_NOT_FOUND");
  }, 30_000);
});

describe("recordCustomerDisputeByStaff — atomic audit (issue #49 convention)", () => {
  it("commits neither the status change nor the audit event when the transaction fails", async () => {
    await seedRequest("r1");
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        recordCustomerDisputeByStaff({
          requestId: "r1",
          actorId: DISPATCHER,
          actorRole: "dispatcher",
          reason: REASON,
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    expect((await requestData("r1"))?.status).toBe("delivered");
    expect(await requestEventTypes("r1")).toHaveLength(0);
  }, 30_000);
});

describe("recordCustomerDisputeByStaff — race safety", () => {
  it("a staff confirmation committed first defeats the stale-page dispute", async () => {
    await seedRequest("r1");

    await confirmDeliveryByStaff({ requestId: "r1", actorId: DISPATCHER });

    await expect(
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ).rejects.toThrow("INVALID_STATUS_FOR_DISPUTE");

    const data = await requestData("r1");
    expect(data?.status).toBe("confirmed");
    const types = await requestEventTypes("r1");
    expect(types).toContain("delivery_confirmed_by_dispatcher");
    expect(types).not.toContain("customer_dispute_recorded_by_staff");
  }, 30_000);

  it("a dispute committed first defeats the stale staff confirmation", async () => {
    await seedRequest("r1");

    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: REASON,
    });

    await expect(
      confirmDeliveryByStaff({ requestId: "r1", actorId: DISPATCHER }),
    ).rejects.toThrow("INVALID_STATUS_FOR_CONFIRM");

    expect((await requestData("r1"))?.status).toBe("disputed");
    expect(await requestEventTypes("r1")).not.toContain(
      "delivery_confirmed_by_dispatcher",
    );
  }, 30_000);

  it("a simultaneous staff-confirm and dispute resolve to exactly one consistent outcome", async () => {
    await seedRequest("r1");

    const [confirmResult, disputeResult] = await Promise.allSettled([
      confirmDeliveryByStaff({ requestId: "r1", actorId: DISPATCHER }),
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ]);

    const data = await requestData("r1");
    const types = await requestEventTypes("r1");

    if (data?.status === "confirmed") {
      expect(confirmResult.status).toBe("fulfilled");
      expect(disputeResult.status).toBe("rejected");
      expect(types).toContain("delivery_confirmed_by_dispatcher");
      expect(types).not.toContain("customer_dispute_recorded_by_staff");
    } else {
      expect(data?.status).toBe("disputed");
      expect(disputeResult.status).toBe("fulfilled");
      expect(confirmResult.status).toBe("rejected");
      expect(types).toContain("customer_dispute_recorded_by_staff");
      expect(types).not.toContain("delivery_confirmed_by_dispatcher");
    }
  }, 30_000);

  it("auto-confirm cannot overwrite a committed dispute, even past the window", async () => {
    // Delivered well past the 24-hour confirmation window.
    await seedRequest("r1", {
      deliveredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: REASON,
    });

    // Lazy auto-confirm must be a no-op on a disputed request.
    const result = await checkDeliveryConfirmationTimeout("r1");
    expect(result?.status).toBe("disputed");
    const types = await requestEventTypes("r1");
    expect(types).not.toContain("delivery_auto_confirmed");
    expect(types).not.toContain("customer_confirmed");
  }, 30_000);

  it("a simultaneous auto-confirm and dispute resolve to exactly one consistent outcome", async () => {
    await seedRequest("r1", {
      deliveredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    const [autoResult, disputeResult] = await Promise.allSettled([
      checkDeliveryConfirmationTimeout("r1"),
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
    ]);

    const data = await requestData("r1");
    const types = await requestEventTypes("r1");

    if (data?.status === "confirmed") {
      // The auto-confirm won the race; the dispute is rejected cleanly.
      expect(autoResult.status).toBe("fulfilled");
      expect(disputeResult.status).toBe("rejected");
      expect(types).toContain("delivery_auto_confirmed");
      expect(types).not.toContain("customer_dispute_recorded_by_staff");
    } else {
      expect(data?.status).toBe("disputed");
      expect(disputeResult.status).toBe("fulfilled");
      expect(types).toContain("customer_dispute_recorded_by_staff");
      expect(types).not.toContain("delivery_auto_confirmed");
    }
  }, 30_000);

  it("duplicate concurrent dispute attempts produce exactly one disputed transition and one event", async () => {
    await seedRequest("r1");

    const [first, second] = await Promise.allSettled([
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: DISPATCHER,
        actorRole: "dispatcher",
        reason: REASON,
      }),
      recordCustomerDisputeByStaff({
        requestId: "r1",
        actorId: ADMIN,
        actorRole: "admin",
        reason: "Second attempt: customer also visited the office.",
      }),
    ]);

    const data = await requestData("r1");
    expect(data?.status).toBe("disputed");

    const succeeded = [first, second].filter(
      (r) => r.status === "fulfilled",
    ).length;
    expect(succeeded).toBe(1);

    const events = await getRequestEvents("r1");
    expect(
      events.filter((e) => e.type === "customer_dispute_recorded_by_staff"),
    ).toHaveLength(1);
  }, 30_000);
});

describe("recordCustomerDisputeByStaff — downstream behavior", () => {
  it("the existing resolve-as-completed workflow accepts a staff-created dispute", async () => {
    await seedRequest("r1");
    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: REASON,
    });

    const resolved = await resolveDisputeCompleted({
      requestId: "r1",
      actorId: DISPATCHER,
      note: "Verified with driver — water was delivered.",
    });
    expect(resolved.status).toBe("confirmed");

    const types = await requestEventTypes("r1");
    expect(types).toContain("customer_dispute_recorded_by_staff");
    expect(types).toContain("dispute_resolved_completed");
  }, 30_000);

  it("the existing resolve-as-reopened workflow accepts a staff-created dispute", async () => {
    await seedRequest("r1");
    await recordCustomerDisputeByStaff({
      requestId: "r1",
      actorId: DISPATCHER,
      actorRole: "dispatcher",
      reason: REASON,
    });

    const reopened = await resolveDisputeReopened({
      requestId: "r1",
      actorId: DISPATCHER,
      note: "Re-deliver tomorrow morning.",
    });
    expect(reopened.status).toBe("available");
    expect(reopened.assignedDriverId).toBeNull();

    const types = await requestEventTypes("r1");
    expect(types).toContain("customer_dispute_recorded_by_staff");
    expect(types).toContain("dispute_resolved_reopened");
  }, 30_000);

  it("the registered-resident dispute path is unchanged", async () => {
    await seedRegisteredRequest("r1");

    const result = await disputeWaterDelivery({
      requestId: "r1",
      customerId: RESIDENT,
      reason: "Water never arrived.",
    });
    expect(result.status).toBe("disputed");

    const events = await getRequestEvents("r1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("customer_disputed");
    expect(events[0].actorId).toBe(RESIDENT);
    expect(events[0].actorRole).toBe("resident");
  }, 30_000);
});
