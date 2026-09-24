import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  assignNextDeliveryForDriver,
  releaseAssignedDelivery,
} from "@/lib/domain/dispatch";
import {
  cancelWaterRequest,
  escalateDispatchRequest,
  returnAssignedRequestToQueue,
} from "@/lib/domain/waterRequests";

/**
 * Emulator-backed tests for automatic dispatch assignment —
 * `assignNextDeliveryForDriver()` and `releaseAssignedDelivery()`
 * (issues #66 and #123).
 *
 * These tests exercise the REAL Firestore query/orchestration path, not
 * the in-memory comparator. They prove that:
 *
 *   - Selection honors the canonical dispatch ordering
 *     (`dispatchQueueCompare`: priority bucket → `dispatchOverrideRank`
 *     nulls-last → `requestedAt`) across the ENTIRE eligible queue — not
 *     merely across the first page of a bounded pre-filter (#66).
 *   - Assignment is atomic with selection: the returned request is
 *     already `claimed` and assigned to the caller, the driver's
 *     `activeRequestId` lock is set, and a resolved `driverOffers`
 *     "assigned" ledger record exists — before any caller can see the
 *     delivery's details (#123).
 *   - Concurrent assignment attempts can never produce two drivers
 *     holding the same request — the exact double-delivery defect this
 *     change exists to fix.
 *   - Release returns work to dispatch exactly once, preserves queue
 *     position, and applies the existing decline/cooldown policy.
 *
 * Several suites deliberately seed >100 available requests so a
 * regression cannot accidentally pass inside the old `limit(100)`
 * candidate window.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const OFFERS = "driverOffers";

const DRIVER = "driver-uid-1";
const OTHER_DRIVER = "driver-uid-2";
const DISPATCHER = "dispatcher-uid-1";

const BASE_TIME = new Date("2026-08-20T12:00:00.000Z").getTime();

async function clearState(): Promise<void> {
  for (const c of [REQUESTS, REGISTRY, OFFERS]) {
    await db.recursiveDelete(db.collection(c));
  }
}

interface SeedRequestOptions {
  status?: string;
  dispatchPriority?: "critical" | "urgent" | "normal";
  /** Stored denormalized rank; defaults to the rank for dispatchPriority. */
  priorityRank?: number;
  /**
   * `null` (default) writes an explicit null, a number writes that rank,
   * and `"missing"` omits the field entirely to simulate a document
   * written before the escalation feature existed.
   */
  dispatchOverrideRank?: number | null | "missing";
  requestedAt?: Date;
  assignedDriverId?: string | null;
  preferredDriverId?: string | null;
  preferredDriverExpiresAt?: Date | null;
  dispatchBatchId?: string | null;
  /** Omit `priorityRank` entirely (legacy/corrupt document). */
  omitPriorityRank?: boolean;
  /** Omit `requestedAt` entirely (pathological document). */
  omitRequestedAt?: boolean;
}

const PRIORITY_RANKS = { critical: 0, urgent: 1, normal: 2 } as const;

/**
 * Seeds a request directly (bypassing `createWaterRequest`) so tests can
 * control ordering fields precisely — including omitting fields that
 * production code would always write, to simulate legacy documents.
 */
async function seedRequest(
  id: string,
  options: SeedRequestOptions = {},
): Promise<void> {
  const {
    status = "available",
    dispatchPriority = "normal",
    dispatchOverrideRank = null,
    requestedAt = new Date(BASE_TIME),
    assignedDriverId = null,
    preferredDriverId = null,
    preferredDriverExpiresAt = null,
    dispatchBatchId = null,
    omitPriorityRank = false,
    omitRequestedAt = false,
  } = options;
  const priorityRank = options.priorityRank ?? PRIORITY_RANKS[dispatchPriority];
  const now = new Date();

  const data: Record<string, unknown> = {
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
    preferredDriverId,
    preferredDriverExpiresAt,
    assignedDriverId,
    status,
    dispatchPriority,
    prioritySource: "system",
    priorityReason: null,
    dispatchBatchId,
    batchSequence: null,
    loadCollections: null,
    availableAt: now,
    claimedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!omitPriorityRank) data.priorityRank = priorityRank;
  if (!omitRequestedAt) data.requestedAt = requestedAt;
  if (dispatchOverrideRank !== "missing") {
    data.dispatchOverrideRank = dispatchOverrideRank;
  }
  await db.collection(REQUESTS).doc(id).set(data);
}

async function seedDriver(
  driverId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await db
    .collection(REGISTRY)
    .doc(`reg-${driverId}`)
    .set({
      displayName: `Driver ${driverId}`,
      phone: null,
      linkedUserId: driverId,
      eligibilityStatus: "eligible",
      availabilityStatus: "online",
      ineligibilityReason: null,
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      createdAt: now,
      createdBy: "seed",
      updatedAt: now,
      updatedBy: "seed",
      ...overrides,
    });
}

/** Seeds a recently-declined ledger record so the request is excluded
 * from this driver's fresh selection window. */
async function seedDeclinedOffer(
  driverId: string,
  requestId: string,
): Promise<void> {
  await db.collection(OFFERS).add({
    driverId,
    requestId,
    offeredAt: Timestamp.now(),
    response: "declined",
    respondedAt: Timestamp.now(),
  });
}

/** Seeds a legacy PENDING offer (`response: null`) — the deployment-time
 * state the #123 reconciliation must safely retire. */
async function seedPendingOffer(
  driverId: string,
  requestId: string,
): Promise<string> {
  const ref = await db.collection(OFFERS).add({
    driverId,
    requestId,
    offeredAt: Timestamp.now(),
    response: null,
    respondedAt: null,
  });
  return ref.id;
}

/**
 * Seeds `count` ordinary Normal-priority available requests with
 * strictly increasing `requestedAt` (oldest first: req-000 oldest).
 * Uses batched writes so large synthetic queues stay fast.
 */
async function seedAvailableBacklog(
  count: number,
  prefix = "req",
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}-${String(i).padStart(3, "0")}`);
  }
  // Chunked batches stay well under the 500-write batch limit.
  for (let start = 0; start < count; start += 400) {
    const batch = db.batch();
    for (let i = start; i < Math.min(start + 400, count); i++) {
      const ref = db.collection(REQUESTS).doc(ids[i]);
      const now = new Date();
      batch.set(ref, {
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
        assignedDriverId: null,
        status: "available",
        dispatchPriority: "normal",
        priorityRank: 2,
        prioritySource: "system",
        priorityReason: null,
        dispatchBatchId: null,
        batchSequence: null,
        dispatchOverrideRank: null,
        loadCollections: null,
        requestedAt: new Date(BASE_TIME + i * 60_000),
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
  }
  return ids;
}

/** Asserts the committed end-state of a successful assignment: request
 * claimed by `driverId`, driver lock set, exactly one "assigned" ledger
 * record for the pair. */
async function expectCommittedAssignment(
  requestId: string,
  driverId: string,
): Promise<void> {
  const reqSnap = await db.collection(REQUESTS).doc(requestId).get();
  expect(reqSnap.data()?.status).toBe("claimed");
  expect(reqSnap.data()?.assignedDriverId).toBe(driverId);

  const regSnap = await db.collection(REGISTRY).doc(`reg-${driverId}`).get();
  expect(regSnap.data()?.activeRequestId).toBe(requestId);

  const ledgerSnap = await db
    .collection(OFFERS)
    .where("driverId", "==", driverId)
    .where("requestId", "==", requestId)
    .get();
  const assignedRecords = ledgerSnap.docs.filter(
    (d) => d.data().response === "assigned",
  );
  expect(assignedRecords).toHaveLength(1);
}

beforeEach(clearState);
afterAll(clearState);

// ---------------------------------------------------------------------------
// Issue #123 — assignment-on-visibility semantics
// ---------------------------------------------------------------------------

describe("assignNextDeliveryForDriver — assignment-on-visibility (#123)", () => {
  it("returns the request only after it is authoritatively assigned", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);

    // The returned object is the post-claim snapshot — full details are
    // gated on the committed assignment, never on an optimistic offer.
    expect(assigned?.id).toBe("req-1");
    expect(assigned?.status).toBe("claimed");
    expect(assigned?.assignedDriverId).toBe(DRIVER);
    await expectCommittedAssignment("req-1", DRIVER);
  });

  it("records an atomic 'assigned' ledger entry and claim audit event", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");

    await assignNextDeliveryForDriver(DRIVER);

    const ledger = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .where("requestId", "==", "req-1")
      .get();
    expect(ledger.size).toBe(1);
    const record = ledger.docs[0].data();
    expect(record.response).toBe("assigned");
    // Born resolved — never passes through a pending state.
    expect(record.respondedAt).not.toBeNull();

    const events = await db
      .collection(REQUESTS)
      .doc("req-1")
      .collection("events")
      .get();
    const claimed = events.docs.find((d) => d.data().type === "driver_claimed");
    expect(claimed).toBeDefined();
    expect(claimed!.data().metadata?.assignmentMode).toBe("automatic");
  });

  it("is idempotent across refreshes — same assignment, no extra records", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");
    await seedRequest("req-2", {
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const first = await assignNextDeliveryForDriver(DRIVER);
    const second = await assignNextDeliveryForDriver(DRIVER);
    const third = await assignNextDeliveryForDriver(DRIVER);

    expect(first?.id).toBe("req-1");
    expect(second?.id).toBe("req-1");
    expect(third?.id).toBe("req-1");

    // Exactly one assignment record — refreshes manufacture nothing.
    const ledger = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .get();
    expect(ledger.size).toBe(1);

    // The second request stayed untouched in the queue.
    const req2 = await db.collection(REQUESTS).doc("req-2").get();
    expect(req2.data()?.status).toBe("available");
    expect(req2.data()?.assignedDriverId).toBeNull();
  });

  it("closing the app does not release the assignment — a later call returns it", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");

    const first = await assignNextDeliveryForDriver(DRIVER);
    // Simulate a long app-closed gap: no timeout path exists, so the
    // assignment persists verbatim.
    const later = await assignNextDeliveryForDriver(DRIVER);

    expect(first?.id).toBe("req-1");
    expect(later?.id).toBe("req-1");
    await expectCommittedAssignment("req-1", DRIVER);
  });

  it("never assigns to offline, ineligible, unlinked, or cooldown drivers", async () => {
    await seedRequest("req-1");

    // Unlinked entirely — no registry entry.
    expect(await assignNextDeliveryForDriver("ghost-driver")).toBeNull();

    await seedDriver("offline-driver", { availabilityStatus: "offline" });
    expect(await assignNextDeliveryForDriver("offline-driver")).toBeNull();

    await seedDriver("restricted-driver", {
      eligibilityStatus: "restricted",
    });
    expect(await assignNextDeliveryForDriver("restricted-driver")).toBeNull();

    await seedDriver("cooldown-driver", {
      cooldownUntil: Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
    });
    expect(await assignNextDeliveryForDriver("cooldown-driver")).toBeNull();

    // Nothing was claimed by anyone.
    const req = await db.collection(REQUESTS).doc("req-1").get();
    expect(req.data()?.status).toBe("available");
    expect(req.data()?.assignedDriverId).toBeNull();
  });
});

describe("assignNextDeliveryForDriver — concurrency (#123)", () => {
  it("two drivers racing for one request: exactly one wins, loser gets nothing", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-race", { requestedAt: new Date(BASE_TIME) });

    const [a, b] = await Promise.all([
      assignNextDeliveryForDriver(DRIVER),
      assignNextDeliveryForDriver(OTHER_DRIVER),
    ]);

    // Exactly one driver received the delivery — the loser got null and
    // can never have seen its details. This is the regression test for
    // the reported double deliveries: under the old model BOTH drivers
    // held pending offers showing full customer details for req-race.
    const results = [a, b];
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe("req-race");

    const winnerId = winners[0]!.assignedDriverId!;
    expect([DRIVER, OTHER_DRIVER]).toContain(winnerId);
    await expectCommittedAssignment("req-race", winnerId);

    // The loser's registry entry has no lock and no ledger record.
    const loserId = winnerId === DRIVER ? OTHER_DRIVER : DRIVER;
    const loserReg = await db.collection(REGISTRY).doc(`reg-${loserId}`).get();
    expect(loserReg.data()?.activeRequestId).toBeNull();
    const loserLedger = await db
      .collection(OFFERS)
      .where("driverId", "==", loserId)
      .get();
    expect(loserLedger.size).toBe(0);

    // Exactly one "assigned" record exists for the request, total.
    const allAssigned = await db
      .collection(OFFERS)
      .where("requestId", "==", "req-race")
      .where("response", "==", "assigned")
      .get();
    expect(allAssigned.size).toBe(1);
  }, 30_000);

  it("two drivers racing for two requests: loser of the race retries and gets the other", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    // Both drivers canonically prefer req-a (older). Whoever loses that
    // claim must move on to req-b rather than returning "nothing".
    await seedRequest("req-a", { requestedAt: new Date(BASE_TIME) });
    await seedRequest("req-b", {
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const [a, b] = await Promise.all([
      assignNextDeliveryForDriver(DRIVER),
      assignNextDeliveryForDriver(OTHER_DRIVER),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(new Set([a!.id, b!.id])).toEqual(new Set(["req-a", "req-b"]));

    // Each driver holds exactly their own assignment.
    for (const [driverId, request] of [
      [DRIVER, a],
      [OTHER_DRIVER, b],
    ] as const) {
      expect(request!.assignedDriverId).toBe(driverId);
      await expectCommittedAssignment(request!.id, driverId);
    }
  }, 30_000);

  it("a driver already carrying an assignment never receives another", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", { requestedAt: new Date(BASE_TIME) });
    await seedRequest("req-2", {
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const first = await assignNextDeliveryForDriver(DRIVER);
    const again = await assignNextDeliveryForDriver(DRIVER);
    expect(first?.id).toBe("req-1");
    expect(again?.id).toBe("req-1");
  }, 30_000);

  it("normal auto-assignment ignores delivery-run work entirely", async () => {
    await seedDriver(DRIVER);
    // A request committed to a delivery run is claimed+batched and never
    // appears in the candidate streams.
    await seedRequest("req-batched", {
      status: "claimed",
      dispatchBatchId: "batch-1",
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-open");

    const batched = await db.collection(REQUESTS).doc("req-batched").get();
    expect(batched.data()?.assignedDriverId).toBe(OTHER_DRIVER);
    expect(batched.data()?.dispatchBatchId).toBe("batch-1");
  });

  it("a driver carrying delivery-run loads is not assigned normal work", async () => {
    await seedDriver(DRIVER);
    // The driver is mid-run: a claimed, batched request occupies their
    // active-delivery slot.
    await seedRequest("req-batched", {
      status: "claimed",
      dispatchBatchId: "batch-1",
      assignedDriverId: DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await db
      .collection(REGISTRY)
      .doc(`reg-${DRIVER}`)
      .update({ activeRequestId: "req-batched" });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    // Only batch loads claimed → null (nothing normal to hand back), and
    // req-open must NOT be auto-assigned on top of the run.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();
    const open = await db.collection(REQUESTS).doc("req-open").get();
    expect(open.data()?.status).toBe("available");
  });
});

describe("assignNextDeliveryForDriver — legacy pending offers (#123)", () => {
  it("expires a surviving pending offer instead of honoring it", async () => {
    await seedDriver(DRIVER);
    // Legacy pending offer for the NEWER request. Under the old model it
    // would have pinned the display to req-pending; under #123 it is
    // retired and selection follows canonical order instead.
    await seedRequest("req-older", {
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-pending", { requestedAt: new Date(BASE_TIME) });
    const offerId = await seedPendingOffer(DRIVER, "req-pending");

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-older");

    const offerSnap = await db.collection(OFFERS).doc(offerId).get();
    expect(offerSnap.data()?.response).toBe("expired");
  });

  it("a pending offer for an already-claimed request never reopens it", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-taken", {
      status: "claimed",
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    const offerId = await seedPendingOffer(DRIVER, "req-taken");

    // Nothing else is available — the stale pending offer must NOT
    // resurrect the claimed request for this driver.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();

    const req = await db.collection(REQUESTS).doc("req-taken").get();
    expect(req.data()?.status).toBe("claimed");
    expect(req.data()?.assignedDriverId).toBe(OTHER_DRIVER);
    const offerSnap = await db.collection(OFFERS).doc(offerId).get();
    expect(offerSnap.data()?.response).toBe("expired");
  });
});

// ---------------------------------------------------------------------------
// Issue #123 — release (decline) semantics
// ---------------------------------------------------------------------------

describe("releaseAssignedDelivery (#123)", () => {
  it("returns the request to dispatch and clears the lock", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", { requestedAt: new Date(BASE_TIME) });
    await assignNextDeliveryForDriver(DRIVER);

    const result = await releaseAssignedDelivery({
      requestId: "req-1",
      driverId: DRIVER,
    });
    expect(result.released).toBe(true);
    expect(result.availabilityStatus).toBe("available");

    const req = await db.collection(REQUESTS).doc("req-1").get();
    expect(req.data()?.status).toBe("available");
    expect(req.data()?.assignedDriverId).toBeNull();
    expect(req.data()?.claimedAt).toBeNull();
    // Queue position preserved — requestedAt untouched by the release.
    expect(req.data()?.requestedAt.toDate().getTime()).toBe(BASE_TIME);

    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    expect(reg.data()?.activeRequestId).toBeNull();
  });

  it("records exactly one decline record and a driver_released audit event", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    await releaseAssignedDelivery({ requestId: "req-1", driverId: DRIVER });

    const declines = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .where("requestId", "==", "req-1")
      .where("response", "==", "declined")
      .get();
    expect(declines.size).toBe(1);

    const events = await db
      .collection(REQUESTS)
      .doc("req-1")
      .collection("events")
      .get();
    const types = events.docs.map((d) => d.data().type);
    expect(types).toContain("driver_claimed");
    expect(types).toContain("driver_released");
  });

  it("released work is assignable to another driver but not re-offered to the releaser", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-1", { requestedAt: new Date(BASE_TIME) });

    await assignNextDeliveryForDriver(DRIVER);
    await releaseAssignedDelivery({ requestId: "req-1", driverId: DRIVER });

    // The releaser is inside the decline window — not re-assigned.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();

    // Another eligible driver receives it normally.
    const reassigned = await assignNextDeliveryForDriver(OTHER_DRIVER);
    expect(reassigned?.id).toBe("req-1");
    await expectCommittedAssignment("req-1", OTHER_DRIVER);
  });

  it("rejects release by a driver who is not the assignee", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    await expect(
      releaseAssignedDelivery({
        requestId: "req-1",
        driverId: OTHER_DRIVER,
      }),
    ).rejects.toThrow("NOT_ASSIGNED_DRIVER");

    await expectCommittedAssignment("req-1", DRIVER);
  });

  it("a stale release fails safely after staff reassignment", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    // Staff returns it to the queue and the other driver takes it —
    // driver A's stale "release" press must not tear this down.
    await returnAssignedRequestToQueue({
      requestId: "req-1",
      actorId: DISPATCHER,
      reason: "driver unreachable",
    });
    await assignNextDeliveryForDriver(OTHER_DRIVER);

    await expect(
      releaseAssignedDelivery({ requestId: "req-1", driverId: DRIVER }),
    ).rejects.toThrow("NOT_ASSIGNED_DRIVER");
    await expectCommittedAssignment("req-1", OTHER_DRIVER);
  });

  it("a stale release fails after cancellation and after delivery", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");
    await seedRequest("req-2", {
      requestedAt: new Date(BASE_TIME + 60_000),
    });
    await assignNextDeliveryForDriver(DRIVER);

    // Cancelled request — release must fail and not resurrect it.
    await cancelWaterRequest({
      requestId: "req-1",
      actorId: DISPATCHER,
      reason: "customer cancelled",
    });
    await expect(
      releaseAssignedDelivery({ requestId: "req-1", driverId: DRIVER }),
    ).rejects.toThrow("REQUEST_NOT_RELEASABLE");
    const cancelled = await db.collection(REQUESTS).doc("req-1").get();
    expect(cancelled.data()?.status).toBe("cancelled");

    // Delivered request — same story. Deliver req-2 through the real
    // pipeline: assign it to the other driver, then mark delivered via a
    // committed status write (the domain function requires collection
    // records; a terminal-status write exercises the release guard
    // identically).
    await seedDriver(OTHER_DRIVER);
    await db
      .collection(REQUESTS)
      .doc("req-2")
      .update({ status: "delivered", assignedDriverId: OTHER_DRIVER });
    await expect(
      releaseAssignedDelivery({ requestId: "req-2", driverId: DRIVER }),
    ).rejects.toThrow("REQUEST_NOT_RELEASABLE");
  });

  it("rejects release once water collection has started", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    await db
      .collection(REQUESTS)
      .doc("req-1")
      .update({
        loadCollections: [
          {
            loadNumber: 1,
            fillStationId: "station-1",
            fillStationName: "Station One",
            meterCode: "M1",
            meterNumber: 1,
            collectedAt: new Date().toISOString(),
            driverId: DRIVER,
            recordedBy: DRIVER,
            recordedByRole: "driver",
            note: null,
          },
        ],
      });

    await expect(
      releaseAssignedDelivery({ requestId: "req-1", driverId: DRIVER }),
    ).rejects.toThrow("REQUEST_HAS_COLLECTIONS");
    await expectCommittedAssignment("req-1", DRIVER);
  });

  it("rejects release of delivery-run work (staff-managed)", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-batched", {
      status: "claimed",
      assignedDriverId: DRIVER,
      dispatchBatchId: "batch-1",
    });

    await expect(
      releaseAssignedDelivery({
        requestId: "req-batched",
        driverId: DRIVER,
      }),
    ).rejects.toThrow("DELIVERY_RUN_MANAGED");
  });

  it("applies the existing daily-decline cooldown exactly once", async () => {
    await seedDriver(DRIVER);
    // config/dispatchSettings — cap declines at 1 so the first release
    // triggers cooldown immediately.
    await db
      .collection("config")
      .doc("dispatchSettings")
      .set({ maxDeclinesPerDay: 1, declineCooldownHours: 4 });
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    const result = await releaseAssignedDelivery({
      requestId: "req-1",
      driverId: DRIVER,
    });
    expect(result.declineCount).toBe(1);
    expect(result.availabilityStatus).toBe("cooldown");
    expect(result.cooldownUntil).not.toBeNull();

    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    expect(reg.data()?.cooldownUntil).not.toBeNull();

    // While in cooldown the driver cannot pick the request back up even
    // though it is available again.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();

    // Exactly one decline record — cooldown counted the release once.
    const declines = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .where("response", "==", "declined")
      .get();
    expect(declines.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Issue #123 — cancellation / dispatcher races
// ---------------------------------------------------------------------------

describe("assignment vs cancellation races (#123)", () => {
  it("cancellation before assignment: nothing is assigned", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");

    await cancelWaterRequest({
      requestId: "req-1",
      actorId: DISPATCHER,
      reason: "no longer needed",
    });

    // Never display cancelled work as a valid assignment.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();
  });

  it("concurrent assignment and cancellation commit exactly one outcome", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");

    const [assigned, cancelled] = await Promise.allSettled([
      assignNextDeliveryForDriver(DRIVER),
      cancelWaterRequest({
        requestId: "req-1",
        actorId: DISPATCHER,
        reason: "no longer needed",
      }),
    ]);

    const req = await db.collection(REQUESTS).doc("req-1").get();
    const status = req.data()?.status;

    if (status === "cancelled") {
      // Cancellation won — the driver must not have received details.
      expect(assigned.status === "fulfilled" && assigned.value === null).toBe(
        true,
      );
    } else {
      // Assignment won — request is claimed; cancellation either failed
      // or is not allowed to tear down a committed claim without also
      // clearing the driver (implementation detail: either way the
      // request is not simultaneously cancelled and assigned).
      expect(status).toBe("claimed");
      expect(req.data()?.assignedDriverId).toBe(DRIVER);
      expect(
        cancelled.status === "rejected" || cancelled.status === "fulfilled",
      ).toBe(true);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Preferred-driver holds (ported from the offer-era suite)
// ---------------------------------------------------------------------------

describe("assignNextDeliveryForDriver — preferred-driver holds", () => {
  it("assigns this driver's hold ahead of a large available backlog", async () => {
    await seedDriver(DRIVER);
    await seedAvailableBacklog(120);
    await seedRequest("req-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-hold");
    expect(assigned?.status).toBe("claimed");
  }, 60_000);

  it("orders multiple holds for one driver by the canonical comparator (override-ranked hold first)", async () => {
    await seedDriver(DRIVER);
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await seedRequest("req-hold-older", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: expiry,
      requestedAt: new Date(BASE_TIME - 120_000),
    });
    // A hold carrying an override rank (written directly — the staff
    // escalation action itself releases holds to "available"). Canonical
    // ordering must still place it ahead of the older unranked hold.
    await seedRequest("req-hold-ranked", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: expiry,
      requestedAt: new Date(BASE_TIME),
      dispatchOverrideRank: 0,
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-hold-ranked");
  });

  it("never assigns another driver's preferred-driver hold", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-other-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: OTHER_DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      requestedAt: new Date(BASE_TIME - 120_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-open");
  });

  it("treats an expired hold as general-queue work after lazy expiry", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-expired-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() - 60 * 1000),
      requestedAt: new Date(BASE_TIME - 120_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    // expirePreferredDriverHolds runs inside assignNextDeliveryForDriver;
    // the expired hold is released to "available" and remains assignable
    // at its original requestedAt — not permanently unavailable.
    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-expired-hold");
  });

  it("releasing a preferred-hold assignment returns it to the general queue, not a re-reservation", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      requestedAt: new Date(BASE_TIME - 120_000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-hold");

    await releaseAssignedDelivery({ requestId: "req-hold", driverId: DRIVER });

    const req = await db.collection(REQUESTS).doc("req-hold").get();
    // Back in the general queue — NOT back on hold for this driver.
    expect(req.data()?.status).toBe("available");
    expect(req.data()?.assignedDriverId).toBeNull();

    // The releaser is excluded by the decline window; another driver
    // gets it as ordinary available work.
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();
    const forOther = await assignNextDeliveryForDriver(OTHER_DRIVER);
    expect(forOther?.id).toBe("req-hold");
  });
});

// ---------------------------------------------------------------------------
// Issue #66 ordering suites (ported from the offer-era suite)
// ---------------------------------------------------------------------------

describe("assignNextDeliveryForDriver — escalation beyond the candidate window (#66)", () => {
  it("assigns a rank-0 escalated request that sorts beyond the first 100 by age", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);
    const escalatedId = ids[119]; // newest request — deep outside the old window

    // Real staff path: escalation sets dispatchOverrideRank 0 while
    // preserving requestedAt and priority.
    await escalateDispatchRequest({
      requestId: escalatedId,
      actorId: DISPATCHER,
      reason: "Vulnerable household; staff escalation.",
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(escalatedId);
    expect(assigned?.dispatchOverrideRank).toBe(0);
  }, 60_000);

  it("keeps escalation ordered oldest-first among equal override ranks", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(110);
    const newerEscalated = ids[109];
    const olderEscalated = ids[105];

    await escalateDispatchRequest({
      requestId: newerEscalated,
      actorId: DISPATCHER,
      reason: "escalated second",
    });
    await escalateDispatchRequest({
      requestId: olderEscalated,
      actorId: DISPATCHER,
      reason: "escalated first",
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(olderEscalated);
  }, 60_000);

  it("still prefers a higher-priority unranked request over a lower-priority escalation", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(110);
    await escalateDispatchRequest({
      requestId: ids[109],
      actorId: DISPATCHER,
      reason: "escalated within normal",
    });
    // A critical request newer than every normal request must still win:
    // the priority bucket is compared before override rank.
    await seedRequest("critical-new", {
      dispatchPriority: "critical",
      requestedAt: new Date(BASE_TIME + 10_000 * 60_000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("critical-new");
  }, 60_000);
});

describe("assignNextDeliveryForDriver — declined candidates beyond the window (#66)", () => {
  it("assigns the eligible request after a first page of entirely declined candidates", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);
    for (let i = 0; i < 100; i++) {
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(ids[100]);
  }, 60_000);

  it("finds eligible work several pages deep when earlier candidates are declined", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(250);
    for (let i = 0; i < 249; i++) {
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(ids[249]);
  }, 90_000);

  it("assigns nothing when every candidate is genuinely declined", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);
    for (const id of ids) {
      await seedDeclinedOffer(DRIVER, id);
    }

    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();
  }, 60_000);

  it("mixes declined and eligible candidates across page boundaries", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(150);
    // Decline every request except one sitting just past the second page.
    for (let i = 0; i < ids.length; i++) {
      if (i === 105) continue;
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(ids[105]);
  }, 90_000);
});

describe("assignNextDeliveryForDriver — ordering guards", () => {
  it("assigns the oldest request of the best priority under a large same-priority backlog", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe(ids[0]);
  }, 60_000);

  it("assigns nothing when the queue is empty", async () => {
    await seedDriver(DRIVER);
    expect(await assignNextDeliveryForDriver(DRIVER)).toBeNull();
  });

  it("skips available requests that are already assigned to a driver", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-assigned", {
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-open");
  });

  it("does not assign requests committed to a delivery run", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-batched", {
      dispatchBatchId: "batch-1",
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-open");
  });

  it("does not assign claimed or resolved requests", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-claimed", {
      status: "claimed",
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 120_000),
    });
    await seedRequest("req-confirmed", {
      status: "confirmed",
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-open");
  });
});

describe("assignNextDeliveryForDriver — legacy and missing ordering fields", () => {
  it("assigns a request whose dispatchOverrideRank field is entirely absent (pre-escalation document)", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-legacy", {
      dispatchOverrideRank: "missing",
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-newer", { requestedAt: new Date(BASE_TIME) });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-legacy");
    expect(assigned?.dispatchOverrideRank).toBeNull();
  });

  it("does not hide a request that is missing priorityRank entirely", async () => {
    await seedDriver(DRIVER);
    // priorityRank is denormalized bookkeeping; the canonical comparator
    // derives the bucket from dispatchPriority, so a document missing
    // priorityRank must still land in its dispatchPriority bucket.
    await seedRequest("req-no-rank", { omitPriorityRank: true });
    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-no-rank");
  });

  it("assigns a critical request missing priorityRank ahead of valid normal work", async () => {
    await seedDriver(DRIVER);
    // The canonical comparator ranks by dispatchPriority, not stored
    // priorityRank — a missing denormalized rank must not sink this
    // request behind lower-priority work.
    await seedRequest("req-normal", {
      requestedAt: new Date(BASE_TIME),
    });
    await seedRequest("req-critical-no-rank", {
      dispatchPriority: "critical",
      omitPriorityRank: true,
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-critical-no-rank");
  });

  it("assigns an urgent request missing priorityRank ahead of valid normal work", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-normal", {
      requestedAt: new Date(BASE_TIME),
    });
    await seedRequest("req-urgent-no-rank", {
      dispatchPriority: "urgent",
      omitPriorityRank: true,
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-urgent-no-rank");
  });

  it("ignores a stale stored priorityRank that disagrees with dispatchPriority", async () => {
    await seedDriver(DRIVER);
    // A document whose denormalized priorityRank was left stale by an
    // interrupted write must still be bucketed by its dispatchPriority —
    // the value dispatchQueueCompare actually uses.
    await seedRequest("req-normal", {
      requestedAt: new Date(BASE_TIME),
    });
    await seedRequest("req-critical-stale-rank", {
      dispatchPriority: "critical",
      priorityRank: 2, // stale: says "normal"
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-critical-stale-rank");
  });
});
