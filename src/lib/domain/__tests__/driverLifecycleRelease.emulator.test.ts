import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { appConfig } from "@/lib/domain/config";
import { setAvailabilityByLinkedUser } from "@/lib/domain/driverRegistry";
import {
  releaseStaleAssignmentIfUnchanged,
  releaseStaleAssignments,
} from "@/lib/domain/staleAssignments";

/**
 * Emulator-backed tests for the assignment release lifecycle added in
 * issue #135:
 *
 *   - `setAvailabilityByLinkedUser(..., "offline")` — explicit Go
 *     Offline atomically releases ordinary releasable assigned work
 *     (decline-accounted), refuses to strand committed (collected)
 *     work, never detaches Delivery Run members, and is idempotent.
 *   - `releaseStaleAssignments()` — the cron-driven sweep that returns
 *     ordinary assignments older than `appConfig.staleAssignmentRelease
 *     Hours` (12h, measured from `claimedAt`) to dispatch, with
 *     per-candidate transactional revalidation and NO decline/cooldown
 *     accounting.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const OFFERS = "driverOffers";
const CONFIG = "config";

const DRIVER = "driver-uid-1";
const OTHER_DRIVER = "driver-uid-2";
const DISPATCHER = "dispatcher-uid-1";

const BASE_TIME = new Date("2026-08-20T12:00:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;

async function clearState(): Promise<void> {
  for (const c of [REQUESTS, REGISTRY, OFFERS, CONFIG]) {
    await db.recursiveDelete(db.collection(c));
  }
}

interface SeedRequestOptions {
  status?: string;
  assignedDriverId?: string | null;
  claimedAt?: Date | null;
  dispatchBatchId?: string | null;
  loadCollections?: unknown[] | null;
  preferredDriverId?: string | null;
  preferredDriverExpiresAt?: Date | null;
  /** Omit `claimedAt` entirely (anomalous/legacy document). */
  omitClaimedAt?: boolean;
}

async function seedRequest(
  id: string,
  options: SeedRequestOptions = {},
): Promise<void> {
  const {
    status = "available",
    assignedDriverId = null,
    claimedAt = null,
    dispatchBatchId = null,
    loadCollections = null,
    preferredDriverId = null,
    preferredDriverExpiresAt = null,
    omitClaimedAt = false,
  } = options;
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
    dispatchPriority: "normal",
    priorityRank: 2,
    prioritySource: "system",
    priorityReason: null,
    dispatchBatchId,
    batchSequence: null,
    dispatchOverrideRank: null,
    loadCollections,
    requestedAt: new Date(BASE_TIME),
    availableAt: now,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!omitClaimedAt) data.claimedAt = claimedAt;
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

async function seedDeclineLimit(limit: number): Promise<void> {
  await db
    .collection(CONFIG)
    .doc("dispatchSettings")
    .set({ maxDeclinesPerDay: limit, declineCooldownHours: 1 });
}

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

async function requestDoc(id: string) {
  return (await db.collection(REQUESTS).doc(id).get()).data()!;
}

async function driverDoc(driverId: string) {
  return (await db.collection(REGISTRY).doc(`reg-${driverId}`).get()).data()!;
}

async function requestEvents(id: string): Promise<Record<string, unknown>[]> {
  const snap = await db.collection(REQUESTS).doc(id).collection("events").get();
  return snap.docs.map((d) => d.data());
}

async function driverEvents(
  driverId: string,
): Promise<Record<string, unknown>[]> {
  const snap = await db
    .collection(REGISTRY)
    .doc(`reg-${driverId}`)
    .collection("events")
    .get();
  return snap.docs.map((d) => d.data());
}

async function declinedLedgerCount(driverId: string): Promise<number> {
  const snap = await db
    .collection(OFFERS)
    .where("driverId", "==", driverId)
    .where("response", "==", "declined")
    .get();
  return snap.size;
}

beforeEach(clearState);
afterAll(clearState);

// ---------------------------------------------------------------------------
// Issue #135 — explicit Go Offline releases a releasable assignment
// ---------------------------------------------------------------------------

describe("Go Offline releases an ordinary assigned delivery (#135)", () => {
  it("returns a releasable assignment to dispatch and takes the driver offline atomically", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(BASE_TIME + HOUR),
    });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual(["req-1"]);
    expect(result.releaseOutcome?.availabilityStatus).toBe("available");

    const req = await requestDoc("req-1");
    expect(req.status).toBe("available");
    expect(req.assignedDriverId).toBeNull();
    expect(req.claimedAt).toBeNull();
    expect(req.preferredDriverId).toBeNull();
    expect(req.preferredDriverExpiresAt).toBeNull();
    // The customer keeps their queue position.
    expect(req.requestedAt.toMillis()).toBe(BASE_TIME);

    const driver = await driverDoc(DRIVER);
    expect(driver.availabilityStatus).toBe("offline");
    expect(driver.activeRequestId).toBeNull();

    // Audit: request event is a driver release tagged with the trigger,
    // registry gets one driver_offline event naming what was released.
    const reqEvents = await requestEvents("req-1");
    const releaseEvents = reqEvents.filter((e) => e.type === "driver_released");
    expect(releaseEvents).toHaveLength(1);
    expect(releaseEvents[0].metadata).toMatchObject({
      trigger: "driver_went_offline",
    });

    const dEvents = await driverEvents(DRIVER);
    const offlineEvents = dEvents.filter((e) => e.type === "driver_offline");
    expect(offlineEvents).toHaveLength(1);
    expect(offlineEvents[0].metadata).toMatchObject({
      releasedRequestIds: ["req-1"],
    });

    // Decline accounting applies — going offline is a driver choice, so
    // it counts exactly like a manual Decline / Release.
    expect(await declinedLedgerCount(DRIVER)).toBe(1);
    const ledger = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .where("requestId", "==", "req-1")
      .where("response", "==", "declined")
      .get();
    expect(ledger.docs[0].data().releaseContext).toBe("driver_went_offline");
  });

  it("takes the driver offline with no work and no release when nothing is assigned", async () => {
    await seedDriver(DRIVER);

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual([]);
    expect(result.releaseOutcome).toBeNull();
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("offline");
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });

  it("fails clearly and keeps the driver ONLINE when water collection has been recorded", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
      loadCollections: [{ loadNumber: 1, gallons: 500 }],
    });

    await expect(
      setAvailabilityByLinkedUser({
        userId: DRIVER,
        availabilityStatus: "offline",
      }),
    ).rejects.toThrow("DRIVER_HAS_COMMITTED_DELIVERY");

    // Nothing changed: driver online, request still claimed and assigned.
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("online");
    expect((await driverDoc(DRIVER)).activeRequestId).toBe("req-1");
    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(DRIVER);
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });

  it("never detaches a Delivery Run member and does not let it block going offline", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-run", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
      dispatchBatchId: "batch-1",
      loadCollections: [{ loadNumber: 1, gallons: 500 }],
    });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual([]);
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("offline");
    const req = await requestDoc("req-run");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(DRIVER);
    expect(req.dispatchBatchId).toBe("batch-1");
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });

  it("releases the ordinary assignment while keeping a Delivery Run lock intact", async () => {
    // activeRequestId points at a run member — the offline release must
    // release only the ordinary request and keep the run lock.
    await seedDriver(DRIVER, { activeRequestId: "req-run" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });
    await seedRequest("req-run", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
      dispatchBatchId: "batch-1",
    });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual(["req-1"]);
    expect((await driverDoc(DRIVER)).activeRequestId).toBe("req-run");
    expect((await requestDoc("req-1")).status).toBe("available");
    expect((await requestDoc("req-run")).status).toBe("claimed");
  });

  it("applies the decline limit: release-triggered cooldown is recorded on the same write", async () => {
    await seedDeclineLimit(2);
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });
    // One earlier decline today → this release reaches the limit.
    await seedDeclinedOffer(DRIVER, "req-old");

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releaseOutcome?.availabilityStatus).toBe("cooldown");
    expect(result.releaseOutcome?.declineCount).toBe(2);
    const driver = await driverDoc(DRIVER);
    expect(driver.availabilityStatus).toBe("offline");
    expect(driver.cooldownUntil).not.toBeNull();
    const cooldownEvents = (await driverEvents(DRIVER)).filter(
      (e) => e.type === "driver_cooldown_started",
    );
    expect(cooldownEvents).toHaveLength(1);
  });

  it("is idempotent: a repeated Go Offline performs no extra writes or ledger records", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });

    await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });
    const second = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(second.releasedRequestIds).toEqual([]);
    // Exactly one declined ledger record and one driver_offline event —
    // a redundant press must not manufacture duplicate history.
    expect(await declinedLedgerCount(DRIVER)).toBe(1);
    const offlineEvents = (await driverEvents(DRIVER)).filter(
      (e) => e.type === "driver_offline",
    );
    expect(offlineEvents).toHaveLength(1);
    const releaseEvents = (await requestEvents("req-1")).filter(
      (e) => e.type === "driver_released",
    );
    expect(releaseEvents).toHaveLength(1);
  });

  it("clears a stale activeRequestId that points at no claimed request", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-gone" });
    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });
    expect(result.releasedRequestIds).toEqual([]);
    expect((await driverDoc(DRIVER)).activeRequestId).toBeNull();
  });

  it("clears the lock while releasing when a concurrent cancellation already ended the assignment", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });
    // A staff cancellation lands first — by the time Go Offline runs,
    // the request is no longer claimed; the driver still goes offline
    // and the stale lock is cleared.
    await db.collection(REQUESTS).doc("req-1").update({
      status: "cancelled",
      assignedDriverId: null,
    });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual([]);
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("offline");
    expect((await driverDoc(DRIVER)).activeRequestId).toBeNull();
    // No release is recorded against a request the driver no longer owns.
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
    expect(
      (await requestEvents("req-1")).filter(
        (e) => e.type === "driver_released",
      ),
    ).toHaveLength(0);
  });

  it("a concurrent staff reassignment is never released by the driver's Go Offline", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });
    // Staff reassigns to another driver before the offline transaction
    // commits — the released set must be empty of this request.
    await db.collection(REQUESTS).doc("req-1").update({
      assignedDriverId: OTHER_DRIVER,
    });
    await seedDriver(OTHER_DRIVER, { activeRequestId: "req-1" });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual([]);
    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(OTHER_DRIVER);
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("offline");
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });

  it("a concurrent delivery is never released by the driver's Go Offline", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(BASE_TIME),
    });
    await db.collection(REQUESTS).doc("req-1").update({
      status: "delivered",
      deliveredAt: new Date(),
    });

    const result = await setAvailabilityByLinkedUser({
      userId: DRIVER,
      availabilityStatus: "offline",
    });

    expect(result.releasedRequestIds).toEqual([]);
    expect((await requestDoc("req-1")).status).toBe("delivered");
    expect((await driverDoc(DRIVER)).availabilityStatus).toBe("offline");
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #135 — 12-hour stale-assignment sweep
// ---------------------------------------------------------------------------

describe("releaseStaleAssignments — 12h assignment timeout (#135)", () => {
  const NOW = new Date(BASE_TIME + 24 * HOUR);

  function staleClaimedAt(): Date {
    return new Date(
      NOW.getTime() - (appConfig.staleAssignmentReleaseHours + 1) * HOUR,
    );
  }

  it("retains an assignment younger than 12 hours", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(
        NOW.getTime() - (appConfig.staleAssignmentReleaseHours * HOUR - 60_000),
      ),
    });

    const result = await releaseStaleAssignments(NOW);

    expect(result.candidates).toBe(0);
    expect(result.released).toBe(0);
    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(DRIVER);
  });

  it("releases an assignment at/past the 12-hour threshold — no decline accounting", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
      preferredDriverId: DRIVER,
      preferredDriverExpiresAt: new Date(NOW.getTime() + HOUR),
    });

    const result = await releaseStaleAssignments(NOW);

    expect(result.candidates).toBe(1);
    expect(result.released).toBe(1);

    const req = await requestDoc("req-1");
    expect(req.status).toBe("available");
    expect(req.assignedDriverId).toBeNull();
    expect(req.claimedAt).toBeNull();
    expect(req.preferredDriverId).toBeNull();

    const driver = await driverDoc(DRIVER);
    expect(driver.activeRequestId).toBeNull();
    // The driver is untouched: still online, no cooldown — this is a
    // system recovery, not a driver decline.
    expect(driver.availabilityStatus).toBe("online");
    expect(driver.cooldownUntil).toBeNull();

    // Distinct audit semantics on both sides.
    const reqEvents = await requestEvents("req-1");
    const auto = reqEvents.filter((e) => e.type === "assignment_auto_released");
    expect(auto).toHaveLength(1);
    expect(auto[0].actorId).toBeNull();
    expect(auto[0].metadata).toMatchObject({ driverId: DRIVER });
    expect(reqEvents.filter((e) => e.type === "driver_released")).toHaveLength(
      0,
    );

    const drvAuto = (await driverEvents(DRIVER)).filter(
      (e) => e.type === "assignment_auto_released",
    );
    expect(drvAuto).toHaveLength(1);
    expect(drvAuto[0].metadata).toMatchObject({ requestId: "req-1" });

    // No declined ledger record — the daily count is untouched.
    expect(await declinedLedgerCount(DRIVER)).toBe(0);
  });

  it("releases exactly at the 12-hour boundary", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: new Date(
        NOW.getTime() - appConfig.staleAssignmentReleaseHours * HOUR,
      ),
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.released).toBe(1);
    expect((await requestDoc("req-1")).status).toBe("available");
  });

  it("is a no-op when the assignment was already released by the driver or staff", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "available",
      assignedDriverId: null,
      claimedAt: null,
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.candidates).toBe(0);
    expect(result.released).toBe(0);
    expect((await requestDoc("req-1")).status).toBe("available");
  });

  it("gives a reassignment a fresh 12-hour window via the reset claimedAt", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER, { activeRequestId: "req-1" });
    // Old request, but reassigned 1 hour ago — the new assignment must
    // NOT be released even though the request is ancient.
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: OTHER_DRIVER,
      claimedAt: new Date(NOW.getTime() - HOUR),
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.released).toBe(0);
    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(OTHER_DRIVER);
    expect((await driverDoc(OTHER_DRIVER)).activeRequestId).toBe("req-1");
  });

  it("a stale candidate whose request was reassigned mid-scan cannot release the new assignment", async () => {
    await seedDriver(DRIVER);
    await seedDriver(OTHER_DRIVER, { activeRequestId: "req-1" });
    const staleAt = staleClaimedAt();
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleAt,
    });

    // Scan saw (DRIVER, staleAt); committed state then changed — staff
    // reassigned to OTHER_DRIVER with a fresh claimedAt. The release
    // transaction must refuse: the identity it validated is gone.
    await db.collection(REQUESTS).doc("req-1").update({
      assignedDriverId: OTHER_DRIVER,
      claimedAt: FieldValue.serverTimestamp(),
    });

    const outcome = await releaseStaleAssignmentIfUnchanged(
      "req-1",
      DRIVER,
      staleAt.getTime(),
      NOW,
    );
    expect(outcome).toBe("skipped_stale");

    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(OTHER_DRIVER);
    expect((await driverDoc(OTHER_DRIVER)).activeRequestId).toBe("req-1");
  });

  it("a stale candidate cannot release even a same-driver RE-assignment (new claimedAt)", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    const staleAt = staleClaimedAt();
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleAt,
    });
    // Reassigned to the SAME driver after the scan — claimedAt moves, so
    // the scanned identity is stale and the new window must hold.
    const freshClaimedAt = new Date(NOW.getTime() - HOUR);
    await db.collection(REQUESTS).doc("req-1").update({
      claimedAt: freshClaimedAt,
    });

    const outcome = await releaseStaleAssignmentIfUnchanged(
      "req-1",
      DRIVER,
      staleAt.getTime(),
      NOW,
    );
    expect(outcome).toBe("skipped_stale");
    expect((await requestDoc("req-1")).status).toBe("claimed");
  });

  it("a stale candidate racing a delivery cannot revert it", async () => {
    const staleAt = staleClaimedAt();
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleAt,
    });
    await db
      .collection(REQUESTS)
      .doc("req-1")
      .update({
        status: "delivered",
        deliveredAt: new Date(NOW),
      });

    const outcome = await releaseStaleAssignmentIfUnchanged(
      "req-1",
      DRIVER,
      staleAt.getTime(),
      NOW,
    );
    expect(outcome).toBe("skipped_stale");
    expect((await requestDoc("req-1")).status).toBe("delivered");
  });

  it("a stale candidate racing a cancellation cannot resurrect the request", async () => {
    const staleAt = staleClaimedAt();
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleAt,
    });
    await db.collection(REQUESTS).doc("req-1").update({
      status: "cancelled",
      assignedDriverId: null,
    });

    const outcome = await releaseStaleAssignmentIfUnchanged(
      "req-1",
      DRIVER,
      staleAt.getTime(),
      NOW,
    );
    expect(outcome).toBe("skipped_stale");
    expect((await requestDoc("req-1")).status).toBe("cancelled");
  });

  it("does not release a delivered request even if claimedAt is old", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "delivered",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.released).toBe(0);
    expect((await requestDoc("req-1")).status).toBe("delivered");
  });

  it("does not release a cancelled request", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "cancelled",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.candidates).toBe(0);
    expect((await requestDoc("req-1")).status).toBe("cancelled");
  });

  it("retains collection-started work even past the threshold", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
      loadCollections: [{ loadNumber: 1, gallons: 500 }],
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.candidates).toBe(1);
    expect(result.released).toBe(0);
    expect(result.skippedStale).toBe(1);
    const req = await requestDoc("req-1");
    expect(req.status).toBe("claimed");
    expect(req.assignedDriverId).toBe(DRIVER);
    expect((await driverDoc(DRIVER)).activeRequestId).toBe("req-1");
  });

  it("retains Delivery Run members even past the threshold", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
      dispatchBatchId: "batch-1",
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.released).toBe(0);
    expect((await requestDoc("req-1")).dispatchBatchId).toBe("batch-1");
  });

  it("flags claimed requests with missing claimedAt as anomalies — never released on guesswork", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      omitClaimedAt: true,
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.missingClaimedAt).toBe(1);
    expect(result.released).toBe(0);
    expect((await requestDoc("req-1")).status).toBe("claimed");
  });

  it("is idempotent and catches what a missed run left behind", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
    });

    // Overlapping runs (a missed-then-doubled schedule, or two ticks):
    // committed-state revalidation means exactly one release happens.
    const [first, second] = await Promise.all([
      releaseStaleAssignments(NOW),
      releaseStaleAssignments(NOW),
    ]);
    expect(first.released + second.released).toBe(1);

    // And a later run is a pure no-op.
    const third = await releaseStaleAssignments(NOW);
    expect(third.candidates).toBe(0);
    expect(third.released).toBe(0);

    const auto = (await requestEvents("req-1")).filter(
      (e) => e.type === "assignment_auto_released",
    );
    expect(auto).toHaveLength(1);
  });

  it("releases assignments across different drivers independently", async () => {
    await seedDriver(DRIVER, { activeRequestId: "req-1" });
    // The lock points at the FRESH claim — releasing the stale sibling
    // must not clear it.
    await seedDriver(OTHER_DRIVER, { activeRequestId: "req-3" });
    await seedRequest("req-1", {
      status: "claimed",
      assignedDriverId: DRIVER,
      claimedAt: staleClaimedAt(),
    });
    await seedRequest("req-2", {
      status: "claimed",
      assignedDriverId: OTHER_DRIVER,
      claimedAt: staleClaimedAt(),
    });
    await seedRequest("req-3", {
      status: "claimed",
      assignedDriverId: OTHER_DRIVER,
      claimedAt: new Date(NOW.getTime() - HOUR),
    });

    const result = await releaseStaleAssignments(NOW);
    expect(result.released).toBe(2);
    expect((await requestDoc("req-1")).status).toBe("available");
    expect((await requestDoc("req-2")).status).toBe("available");
    // The fresh assignment survives.
    expect((await requestDoc("req-3")).status).toBe("claimed");
    expect((await driverDoc(OTHER_DRIVER)).activeRequestId).toBe("req-3");
  });
});
