import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminDb } from "@/lib/firebase/admin";
import { assignNextDeliveryForDriver } from "@/lib/domain/dispatch";
import {
  acknowledgeDriverWorkflowNotice,
  createDriver,
  getDriverByLinkedUserId,
} from "@/lib/domain/driverRegistry";
import {
  CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
  requiresWorkflowNoticeAcknowledgement,
} from "@/lib/domain/driverWorkflowNotice";

/**
 * Emulator-backed tests for the versioned driver workflow-notice
 * acknowledgement (issue #123 follow-up).
 *
 * These exercise the real Admin SDK / Firestore transaction path and prove:
 *
 *   - Acknowledgement writes the CURRENT notice version and a server
 *     timestamp on the driver's own registry entry, resolved by
 *     `linkedUserId` — a caller can never acknowledge for another driver.
 *   - The write is idempotent and monotonic: repeats are no-ops, racing
 *     tabs are safe, and a stale (older) version can never downgrade a
 *     newer stored acknowledgement.
 *   - Acknowledgement is education only: it neither depends on nor
 *     affects automatic assignment — an unacknowledged online driver is
 *     still assigned, and acknowledging never releases/alters a held
 *     delivery, the activeRequestId lock, availability, or cooldown.
 *   - Driver records written before the fields existed remain valid and
 *     are treated as "never acknowledged" (version 0).
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REGISTRY = "driverRegistry";
const REQUESTS = "waterRequests";
const OFFERS = "driverOffers";

const DRIVER = "driver-uid-1";
const OTHER_DRIVER = "driver-uid-2";

async function clearState(): Promise<void> {
  for (const c of [REGISTRY, REQUESTS, OFFERS]) {
    await db.recursiveDelete(db.collection(c));
  }
}

/** Seeds a registry entry exactly as an existing (pre-notice) driver
 * looks: NO acknowledgement fields at all. */
async function seedDriver(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = new Date();
  const ref = db.collection(REGISTRY).doc(`reg-${userId}`);
  await ref.set({
    displayName: `Driver ${userId}`,
    phone: null,
    linkedUserId: userId,
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
  return ref.id;
}

/** Minimal assignable request for the dispatch-independence checks. */
async function seedRequest(id: string): Promise<void> {
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
      createdBy: "dispatcher-uid-1",
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
      requestedAt: now,
      availableAt: now,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
}

async function ackEvents(registryId: string) {
  const snap = await db
    .collection(REGISTRY)
    .doc(registryId)
    .collection("events")
    .where("type", "==", "driver_workflow_notice_acknowledged")
    .get();
  return snap.docs.map((d) => d.data());
}

beforeEach(clearState);
afterAll(clearState);

describe("acknowledgeDriverWorkflowNotice — persistence", () => {
  it("writes the current version and a server timestamp on the driver's own entry", async () => {
    const registryId = await seedDriver(DRIVER);

    const entry = await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    expect(entry.id).toBe(registryId);
    expect(entry.workflowNoticeAcknowledgedVersion).toBe(
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    );
    expect(entry.workflowNoticeAcknowledgedAt).not.toBeNull();
    // Roughly now — proves a real timestamp, not epoch/null defaults.
    expect(
      new Date(entry.workflowNoticeAcknowledgedAt!).getTime(),
    ).toBeGreaterThan(Date.now() - 60_000);

    // The persisted (server-side) state now suppresses the notice — the
    // same answer any other device gets on its next render.
    expect(
      requiresWorkflowNoticeAcknowledgement(
        entry.workflowNoticeAcknowledgedVersion,
      ),
    ).toBe(false);
  });

  it("records a driver_workflow_notice_acknowledged audit event with the version", async () => {
    const registryId = await seedDriver(DRIVER);

    await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    const events = await ackEvents(registryId);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(DRIVER);
    expect(events[0].actorRole).toBe("driver");
    expect(events[0].metadata?.noticeVersion).toBe(
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    );
  });

  it("repeated acknowledgement is a safe no-op (one event, unchanged timestamp)", async () => {
    const registryId = await seedDriver(DRIVER);

    const first = await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });
    const second = await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    expect(second.workflowNoticeAcknowledgedVersion).toBe(
      first.workflowNoticeAcknowledgedVersion,
    );
    expect(second.workflowNoticeAcknowledgedAt).toBe(
      first.workflowNoticeAcknowledgedAt,
    );
    expect(await ackEvents(registryId)).toHaveLength(1);
  });

  it("concurrent acknowledgements (two tabs) settle on exactly one write", async () => {
    const registryId = await seedDriver(DRIVER);

    const [a, b] = await Promise.all([
      acknowledgeDriverWorkflowNotice({
        userId: DRIVER,
        noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
      }),
      acknowledgeDriverWorkflowNotice({
        userId: DRIVER,
        noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
      }),
    ]);

    expect(a.workflowNoticeAcknowledgedVersion).toBe(
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    );
    expect(b.workflowNoticeAcknowledgedVersion).toBe(
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    );
    expect(await ackEvents(registryId)).toHaveLength(1);
  });

  it("an older version can never downgrade a newer stored acknowledgement", async () => {
    const future = CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1;
    const registryId = await seedDriver(DRIVER, {
      workflowNoticeAcknowledgedVersion: future,
      workflowNoticeAcknowledgedAt: new Date(),
    });

    const entry = await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    // The stored v2 remains authoritative — and the notice logic agrees.
    expect(entry.workflowNoticeAcknowledgedVersion).toBe(future);
    expect(await ackEvents(registryId)).toHaveLength(0);
  });

  it("rejects versions the driver could never have been shown", async () => {
    await seedDriver(DRIVER);

    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1,
    ]) {
      await expect(
        acknowledgeDriverWorkflowNotice({
          userId: DRIVER,
          noticeVersion: bad,
        }),
      ).rejects.toThrow("INVALID_NOTICE_VERSION");
    }

    const entry = await getDriverByLinkedUserId(DRIVER);
    expect(entry!.workflowNoticeAcknowledgedVersion).toBe(0);
  });
});

describe("acknowledgeDriverWorkflowNotice — authorization boundary", () => {
  it("resolves the caller's own registry entry by linkedUserId only", async () => {
    const registryA = await seedDriver(DRIVER);
    const registryB = await seedDriver(OTHER_DRIVER);

    await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    const a = await db.collection(REGISTRY).doc(registryA).get();
    const b = await db.collection(REGISTRY).doc(registryB).get();
    expect(a.data()?.workflowNoticeAcknowledgedVersion).toBe(
      CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    );
    // The other driver's entry is untouched — the API has no way to name
    // a target driver, so a driver cannot acknowledge for anyone else.
    expect(b.data()?.workflowNoticeAcknowledgedVersion ?? 0).toBe(0);
  });

  it("rejects a caller with no linked driver registry entry", async () => {
    await expect(
      acknowledgeDriverWorkflowNotice({
        userId: "no-such-driver",
        noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
      }),
    ).rejects.toThrow("DRIVER_NOT_FOUND");
  });
});

describe("workflow notice — record compatibility", () => {
  it("a pre-existing driver record without the new fields reads as never-acknowledged", async () => {
    await seedDriver(DRIVER); // no acknowledgement fields at all

    const entry = await getDriverByLinkedUserId(DRIVER);
    expect(entry).not.toBeNull();
    expect(entry!.workflowNoticeAcknowledgedVersion).toBe(0);
    expect(entry!.workflowNoticeAcknowledgedAt).toBeNull();
    // …and therefore the notice is required on the next /driver render.
    expect(
      requiresWorkflowNoticeAcknowledgement(
        entry!.workflowNoticeAcknowledgedVersion,
      ),
    ).toBe(true);
  });

  it("createDriver does not fabricate an acknowledgement", async () => {
    const created = await createDriver({
      displayName: "Brand New Driver",
      phone: null,
      actorId: "admin-1",
    });

    expect(created.workflowNoticeAcknowledgedVersion).toBe(0);
    expect(created.workflowNoticeAcknowledgedAt).toBeNull();

    // The fields are absent on the stored document — acknowledgement
    // only ever comes from a real acknowledgement.
    const raw = await db.collection(REGISTRY).doc(created.id).get();
    expect(raw.data()).not.toHaveProperty("workflowNoticeAcknowledgedVersion");
    expect(raw.data()).not.toHaveProperty("workflowNoticeAcknowledgedAt");
  });
});

describe("workflow notice — independence from assignment authority (#123)", () => {
  it("an online driver who has NOT acknowledged is still auto-assigned", async () => {
    await seedDriver(DRIVER); // never acknowledged
    await seedRequest("req-1");

    const assigned = await assignNextDeliveryForDriver(DRIVER);

    // The acknowledgement modal may cover the page, but assignment is
    // authoritative regardless — the notice is education, not a gate.
    expect(assigned?.id).toBe("req-1");
    expect(assigned?.status).toBe("claimed");
    expect(assigned?.assignedDriverId).toBe(DRIVER);

    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    expect(reg.data()?.activeRequestId).toBe("req-1");
    // …and the acknowledgement state is still untouched.
    expect(reg.data()?.workflowNoticeAcknowledgedVersion ?? 0).toBe(0);
  });

  it("acknowledging while holding an assignment changes nothing operational", async () => {
    await seedDriver(DRIVER);
    await seedRequest("req-1");
    await assignNextDeliveryForDriver(DRIVER);

    // The driver acknowledges with an assigned delivery on screen.
    await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });

    const req = await db.collection(REQUESTS).doc("req-1").get();
    expect(req.data()?.status).toBe("claimed");
    expect(req.data()?.assignedDriverId).toBe(DRIVER);

    const reg = await db.collection(REGISTRY).doc(`reg-${DRIVER}`).get();
    // Lock, availability, cooldown: untouched by the acknowledgement.
    expect(reg.data()?.activeRequestId).toBe("req-1");
    expect(reg.data()?.availabilityStatus).toBe("online");
    expect(reg.data()?.cooldownUntil).toBeNull();
  });

  it("assignment also ignores an existing acknowledgement entirely", async () => {
    await seedDriver(DRIVER);
    await acknowledgeDriverWorkflowNotice({
      userId: DRIVER,
      noticeVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
    });
    await seedRequest("req-1");

    const assigned = await assignNextDeliveryForDriver(DRIVER);
    expect(assigned?.id).toBe("req-1");

    // No ledger side-effects from acknowledging.
    const ledger = await db
      .collection(OFFERS)
      .where("driverId", "==", DRIVER)
      .where("requestId", "==", "req-1")
      .get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].data().response).toBe("assigned");
  });
});
