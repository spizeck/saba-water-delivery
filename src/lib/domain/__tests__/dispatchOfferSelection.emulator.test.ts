import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  acceptDriverOffer,
  getNextOfferForDriver,
} from "@/lib/domain/dispatch";
import { escalateDispatchRequest } from "@/lib/domain/waterRequests";

/**
 * Emulator-backed tests for driver-offer candidate selection —
 * `getNextOfferForDriver()` (issue #66).
 *
 * These tests exercise the REAL Firestore query/orchestration path, not
 * the in-memory comparator. They prove that selecting the next request
 * for a driver honors the canonical dispatch ordering
 * (`dispatchQueueCompare`: priority bucket → `dispatchOverrideRank`
 * nulls-last → `requestedAt`) across the ENTIRE eligible queue — not
 * merely across the first page of a bounded pre-filter — and that a
 * page of ineligible/declined candidates is never mistaken for an
 * empty queue.
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

/** Seeds a recently-declined offer record so the request is excluded
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

beforeEach(clearState);
afterAll(clearState);

describe("getNextOfferForDriver — escalation beyond the candidate window (#66)", () => {
  it("offers a rank-0 escalated request that sorts beyond the first 100 by age", async () => {
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(escalatedId);
    expect(offer?.request.dispatchOverrideRank).toBe(0);
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(olderEscalated);
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("critical-new");
  }, 60_000);
});

describe("getNextOfferForDriver — declined candidates beyond the window (#66)", () => {
  it("returns the eligible request after a first page of entirely declined candidates", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);
    for (let i = 0; i < 100; i++) {
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(ids[100]);
  }, 60_000);

  it("finds eligible work several pages deep when earlier candidates are declined", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(250);
    for (let i = 0; i < 249; i++) {
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(ids[249]);
  }, 90_000);

  it("returns no offer when every candidate is genuinely declined", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);
    for (const id of ids) {
      await seedDeclinedOffer(DRIVER, id);
    }

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer).toBeNull();
  }, 60_000);

  it("mixes declined and eligible candidates across page boundaries", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(150);
    // Decline every request except one sitting just past the second page.
    for (let i = 0; i < ids.length; i++) {
      if (i === 105) continue;
      await seedDeclinedOffer(DRIVER, ids[i]);
    }

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(ids[105]);
  }, 90_000);
});

describe("getNextOfferForDriver — ordering guards", () => {
  it("offers the oldest request of the best priority under a large same-priority backlog", async () => {
    await seedDriver(DRIVER);
    const ids = await seedAvailableBacklog(120);

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe(ids[0]);
  }, 60_000);

  it("offers nothing when the queue is empty", async () => {
    await seedDriver(DRIVER);
    expect(await getNextOfferForDriver(DRIVER)).toBeNull();
  });

  it("skips available requests that are already assigned to a driver", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-assigned", {
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-open");
  });

  it("does not offer requests committed to a delivery run", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-batched", {
      dispatchBatchId: "batch-1",
      assignedDriverId: OTHER_DRIVER,
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-open");
  });

  it("does not offer claimed or resolved requests", async () => {
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-open");
  });
});

describe("getNextOfferForDriver — legacy and missing ordering fields", () => {
  it("offers a request whose dispatchOverrideRank field is entirely absent (pre-escalation document)", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-legacy", {
      dispatchOverrideRank: "missing",
      requestedAt: new Date(BASE_TIME - 60_000),
    });
    await seedRequest("req-newer", { requestedAt: new Date(BASE_TIME) });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-legacy");
    expect(offer?.request.dispatchOverrideRank).toBeNull();
  });

  it("does not hide a request that is missing priorityRank entirely", async () => {
    await seedDriver(DRIVER);
    // priorityRank is denormalized bookkeeping; the canonical comparator
    // derives the bucket from dispatchPriority, so a document missing
    // priorityRank must still land in its dispatchPriority bucket.
    await seedRequest("req-no-rank", { omitPriorityRank: true });
    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-no-rank");
  });

  it("offers a critical request missing priorityRank ahead of valid normal work", async () => {
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-critical-no-rank");
  });

  it("offers an urgent request missing priorityRank ahead of valid normal work", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-normal", {
      requestedAt: new Date(BASE_TIME),
    });
    await seedRequest("req-urgent-no-rank", {
      dispatchPriority: "urgent",
      omitPriorityRank: true,
      requestedAt: new Date(BASE_TIME + 60_000),
    });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-urgent-no-rank");
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-critical-stale-rank");
  });
});

describe("getNextOfferForDriver — preferred-driver holds", () => {
  it("offers this driver's hold ahead of a large available backlog", async () => {
    await seedDriver(DRIVER);
    await seedAvailableBacklog(120);
    await seedRequest("req-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-hold");
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

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-hold-ranked");
  });

  it("never offers another driver's preferred-driver hold", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-other-hold", {
      status: "preferred_driver_hold",
      preferredDriverId: OTHER_DRIVER,
      preferredDriverExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      requestedAt: new Date(BASE_TIME - 120_000),
    });
    await seedRequest("req-open", { requestedAt: new Date(BASE_TIME) });

    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-open");
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

    // expirePreferredDriverHolds runs inside getNextOfferForDriver; the
    // expired hold is released to "available" and remains offerable at
    // its original requestedAt — not permanently unavailable.
    const offer = await getNextOfferForDriver(DRIVER);
    expect(offer?.request.id).toBe("req-expired-hold");

    const snap = await db.collection(REQUESTS).doc("req-expired-hold").get();
    expect(snap.data()?.status).toBe("available");
  });
});

describe("getNextOfferForDriver — concurrency safety", () => {
  it("fails cleanly when another driver claims the offered request first", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER);
    await seedRequest("req-race", { requestedAt: new Date(BASE_TIME) });

    const offerA = await getNextOfferForDriver(DRIVER);
    const offerB = await getNextOfferForDriver(OTHER_DRIVER);
    expect(offerA?.request.id).toBe("req-race");
    expect(offerB?.request.id).toBe("req-race");

    // First accept wins the atomic claim; the loser's offer is expired.
    await acceptDriverOffer({
      offerId: offerA!.offer.id,
      driverId: DRIVER,
    });
    await expect(
      acceptDriverOffer({ offerId: offerB!.offer.id, driverId: OTHER_DRIVER }),
    ).rejects.toThrow();

    const offerSnap = await db.collection(OFFERS).doc(offerB!.offer.id).get();
    expect(offerSnap.data()?.response).toBe("expired");
  }, 30_000);
});
