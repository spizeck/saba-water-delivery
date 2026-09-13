import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { type Transaction, Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  markWaterDelivered,
  markWaterDeliveredByStaff,
} from "@/lib/domain/waterRequests";
import { NOTIFICATION_OUTBOX_COLLECTION } from "@/lib/notifications/outbox";
import {
  MAX_ATTEMPTS,
  BACKOFF_SCHEDULE_MS,
  outboxIdFor,
  providerIdempotencyKeyFor,
  type SendOutcome,
} from "@/lib/notifications/outboxPolicy";
import { processNotificationOutbox } from "@/lib/notifications/worker";
import {
  listNotificationsByState,
  retryFailedNotification,
} from "@/lib/notifications/outboxAdmin";

/**
 * Emulator-backed tests for the durable notification outbox (issue #53):
 * atomic intent creation, retry/backoff, idempotency, worker leasing/
 * concurrency, the provider-accept/local-crash window, terminal/config
 * failures, and the admin manual retry. The retry/idempotency/lease behavior is
 * exercised with an INJECTED fake provider so it is deterministic and never
 * touches Resend. Runs only under `npm run test:rules`.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";
const REGISTRY = "driverRegistry";
const USERS = "users";
const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);

async function clearState(): Promise<void> {
  for (const c of [
    REQUESTS,
    REGISTRY,
    USERS,
    NOTIFICATION_OUTBOX_COLLECTION,
    "dispatchBatches",
  ]) {
    await db.recursiveDelete(db.collection(c));
  }
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

async function seedClaimedRequest(opts: {
  requestId: string;
  customerId: string | null;
  driverId: string;
}): Promise<void> {
  const ts = Timestamp.fromMillis(BASE);
  await db
    .collection(REQUESTS)
    .doc(opts.requestId)
    .set({
      status: "claimed",
      assignedDriverId: opts.driverId,
      customerId: opts.customerId,
      loads: 1,
      gallons: 1000,
      village: "Windwardside",
      deliveryDirections: "Blue gate",
      dispatchBatchId: null,
      loadCollections: [{ loadNumber: 1 }],
      deliveredAt: null,
      requestedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  await db.collection(REGISTRY).doc(`reg-${opts.driverId}`).set({
    linkedUserId: opts.driverId,
    activeRequestId: opts.requestId,
    eligibilityStatus: "eligible",
  });
  if (opts.customerId) {
    await db
      .collection(USERS)
      .doc(opts.customerId)
      .set({
        displayName: "Jane Resident",
        email: "jane@example.com",
        authStatus: "claimed",
        roles: ["resident"],
      });
  }
}

interface SeedOutboxOverrides {
  requestId?: string;
  customerId?: string | null;
  state?: string;
  attemptCount?: number;
  nextAttemptAtMs?: number;
  leaseOwner?: string | null;
  leaseExpiresAtMs?: number | null;
  sentAtMs?: number | null;
}

async function seedOutbox(
  id: string,
  o: SeedOutboxOverrides = {},
): Promise<void> {
  const requestId = o.requestId ?? "req-x";
  await db
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .doc(id)
    .set({
      type: "delivery_confirmation_email",
      requestId,
      customerId: o.customerId ?? "cust-x",
      providerIdempotencyKey: providerIdempotencyKeyFor(requestId),
      state: o.state ?? "pending",
      attemptCount: o.attemptCount ?? 0,
      createdAt: Timestamp.fromMillis(BASE),
      updatedAt: Timestamp.fromMillis(BASE),
      nextAttemptAt: Timestamp.fromMillis(o.nextAttemptAtMs ?? BASE),
      lastAttemptAt: null,
      sentAt: o.sentAtMs != null ? Timestamp.fromMillis(o.sentAtMs) : null,
      providerMessageId: null,
      failureCategory: null,
      failureReason: null,
      leaseOwner: o.leaseOwner ?? null,
      leaseExpiresAt:
        o.leaseExpiresAtMs != null
          ? Timestamp.fromMillis(o.leaseExpiresAtMs)
          : null,
    });
}

async function readOutbox(id: string) {
  const snap = await db
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .doc(id)
    .get();
  return snap.exists ? snap.data()! : null;
}

/** Fake provider sender that records every provider idempotency key it sees. */
function recordingSender(
  outcome: SendOutcome | ((n: number) => SendOutcome),
): ((record: { providerIdempotencyKey: string }) => Promise<SendOutcome>) & {
  keys: string[];
} {
  const keys: string[] = [];
  const fn = async (record: { providerIdempotencyKey: string }) => {
    keys.push(record.providerIdempotencyKey);
    return typeof outcome === "function" ? outcome(keys.length) : outcome;
  };
  return Object.assign(fn, { keys });
}

const SENT: SendOutcome = { status: "sent", providerMessageId: "resend-1" };
const TRANSIENT: SendOutcome = {
  status: "failed",
  category: "transient",
  reason: "rate_limit_exceeded",
};

beforeEach(async () => {
  await clearState();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// --- Durable intent, atomic with the delivery transition -------------------

describe("durable intent is atomic with the delivery mutation", () => {
  it("commits delivery AND the outbox intent together (driver path)", async () => {
    await seedClaimedRequest({
      requestId: "req-1",
      customerId: "cust-1",
      driverId: "drv-1",
    });
    await markWaterDelivered({ requestId: "req-1", driverId: "drv-1" });

    const request = (await db.collection(REQUESTS).doc("req-1").get()).data()!;
    expect(request.status).toBe("delivered");
    expect(request.deliveredAt).not.toBeNull();

    const intent = await readOutbox(
      outboxIdFor("delivery_confirmation_email", "req-1"),
    );
    expect(intent).not.toBeNull();
    expect(intent!.state).toBe("pending");
    expect(intent!.customerId).toBe("cust-1");
    expect(intent!.providerIdempotencyKey).toBe("delivery-confirmation-req-1");

    // The delivery audit event is still recorded.
    const events = await db
      .collection(REQUESTS)
      .doc("req-1")
      .collection("events")
      .get();
    expect(events.docs.some((d) => d.data().type === "marked_delivered")).toBe(
      true,
    );
  });

  it("rolls BOTH back if the transaction fails (no delivery, no intent)", async () => {
    await seedClaimedRequest({
      requestId: "req-2",
      customerId: "cust-2",
      driverId: "drv-2",
    });
    const injected = failNextTransactionAfterStaging();
    await expect(
      markWaterDelivered({ requestId: "req-2", driverId: "drv-2" }),
    ).rejects.toThrow("INJECTED_TXN_FAILURE");
    injected.restore();

    const request = (await db.collection(REQUESTS).doc("req-2").get()).data()!;
    expect(request.status).toBe("claimed"); // NOT delivered
    const intent = await readOutbox(
      outboxIdFor("delivery_confirmation_email", "req-2"),
    );
    expect(intent).toBeNull(); // no orphaned notification intent
  });

  it("creates NO intent for an unregistered requestor (no authenticated link)", async () => {
    await seedClaimedRequest({
      requestId: "req-3",
      customerId: null,
      driverId: "drv-3",
    });
    await markWaterDeliveredByStaff({
      requestId: "req-3",
      actorId: "disp-1",
    });
    const request = (await db.collection(REQUESTS).doc("req-3").get()).data()!;
    expect(request.status).toBe("delivered"); // delivery still succeeds
    const intent = await readOutbox(
      outboxIdFor("delivery_confirmation_email", "req-3"),
    );
    expect(intent).toBeNull();
  });
});

// --- Retry / backoff --------------------------------------------------------

describe("retry and bounded backoff", () => {
  it("schedules a backoff retry on a transient failure, then sends when due", async () => {
    await seedOutbox("n1", { requestId: "req-1", nextAttemptAtMs: BASE });

    const r1 = await processNotificationOutbox({
      now: BASE,
      send: recordingSender(TRANSIENT),
      rng: () => 0.5,
      leaseOwner: "w1",
    });
    expect(r1.retried).toBe(1);
    let doc = (await readOutbox("n1"))!;
    expect(doc.state).toBe("pending");
    expect(doc.attemptCount).toBe(1);
    expect(doc.failureCategory).toBe("transient");
    expect(doc.leaseOwner).toBeNull();
    expect(doc.nextAttemptAt.toMillis()).toBe(BASE + BACKOFF_SCHEDULE_MS[0]);

    // Not yet eligible before nextAttemptAt.
    const rEarly = await processNotificationOutbox({
      now: BASE + BACKOFF_SCHEDULE_MS[0] - 1,
      send: recordingSender(SENT),
      leaseOwner: "w1",
    });
    expect(rEarly.claimed).toBe(0);

    // Eligible at nextAttemptAt → success → sent.
    const r2 = await processNotificationOutbox({
      now: BASE + BACKOFF_SCHEDULE_MS[0],
      send: recordingSender(SENT),
      leaseOwner: "w1",
    });
    expect(r2.sent).toBe(1);
    doc = (await readOutbox("n1"))!;
    expect(doc.state).toBe("sent");
    expect(doc.attemptCount).toBe(2);
    expect(doc.providerMessageId).toBe("resend-1");
    expect(doc.sentAt).not.toBeNull();
  });

  it("becomes terminal max_attempts once the attempt cap is reached", async () => {
    await seedOutbox("n2", {
      requestId: "req-2",
      attemptCount: MAX_ATTEMPTS - 1,
      nextAttemptAtMs: BASE,
    });
    const r = await processNotificationOutbox({
      now: BASE,
      send: recordingSender(TRANSIENT),
      leaseOwner: "w1",
    });
    expect(r.terminal).toBe(1);
    const doc = (await readOutbox("n2"))!;
    expect(doc.state).toBe("failed");
    expect(doc.attemptCount).toBe(MAX_ATTEMPTS);
    expect(doc.failureCategory).toBe("max_attempts");
  });
});

// --- Idempotency ------------------------------------------------------------

describe("idempotency", () => {
  it("does not resend a sent notification and keeps the provider key stable", async () => {
    await seedOutbox("n3", { requestId: "req-3", nextAttemptAtMs: BASE });
    const send1 = recordingSender(SENT);
    await processNotificationOutbox({
      now: BASE,
      send: send1,
      leaseOwner: "w1",
    });
    expect(send1.keys).toEqual(["delivery-confirmation-req-3"]);

    // A later pass must not claim or resend the already-sent notification.
    const send2 = recordingSender(SENT);
    const r2 = await processNotificationOutbox({
      now: BASE + 10_000_000,
      send: send2,
      leaseOwner: "w2",
    });
    expect(r2.claimed).toBe(0);
    expect(send2.keys).toEqual([]);
    expect((await readOutbox("n3"))!.state).toBe("sent");
  });
});

// --- Concurrency / leasing --------------------------------------------------

describe("worker leasing and concurrency", () => {
  it("prevents two overlapping workers from sending the same notification", async () => {
    await seedOutbox("n4", { requestId: "req-4", nextAttemptAtMs: BASE });

    // Worker A's sender runs Worker B WHILE A holds the lease. B must skip.
    let bResult: Awaited<ReturnType<typeof processNotificationOutbox>> | null =
      null;
    const senderRunsB = recordingSender(() => SENT);
    const senderA = async (record: { providerIdempotencyKey: string }) => {
      bResult = await processNotificationOutbox({
        now: BASE,
        send: recordingSender(SENT),
        leaseOwner: "B",
      });
      return senderRunsB(record);
    };

    const aResult = await processNotificationOutbox({
      now: BASE,
      send: senderA,
      leaseOwner: "A",
    });

    expect(aResult.sent).toBe(1);
    expect(bResult!.claimed).toBe(0); // B could not claim A's active lease
    expect((await readOutbox("n4"))!.state).toBe("sent");
  });

  it("reclaims a notification whose processing lease has expired", async () => {
    await seedOutbox("n5", {
      requestId: "req-5",
      state: "processing",
      leaseOwner: "dead-worker",
      leaseExpiresAtMs: BASE - 1000, // already expired
    });
    const r = await processNotificationOutbox({
      now: BASE,
      send: recordingSender(SENT),
      leaseOwner: "w-live",
    });
    expect(r.claimed).toBe(1);
    expect(r.sent).toBe(1);
    expect((await readOutbox("n5"))!.state).toBe("sent");
  });

  it("does not let a full pending queue starve an expired-lease reclaim", async () => {
    // Two pending-due notifications and one expired lease, but a batch limit of
    // 2. The expired lease (crashed-worker recovery) must still be claimed this
    // pass — interleaved with pending — not starved behind the pending backlog.
    await seedOutbox("p1", { requestId: "rp1", nextAttemptAtMs: BASE });
    await seedOutbox("p2", { requestId: "rp2", nextAttemptAtMs: BASE });
    await seedOutbox("e1", {
      requestId: "re1",
      state: "processing",
      leaseOwner: "dead",
      leaseExpiresAtMs: BASE - 1000,
    });
    const r = await processNotificationOutbox({
      now: BASE,
      limit: 2,
      send: recordingSender(SENT),
      leaseOwner: "w1",
    });
    expect(r.claimed).toBe(2);
    expect((await readOutbox("e1"))!.state).toBe("sent");
  });
});

// --- Provider-accepted / local-record crash window --------------------------

describe("provider-accept then local-record crash", () => {
  it("reuses the identical provider idempotency key on the retry", async () => {
    await seedOutbox("n6", { requestId: "req-6", nextAttemptAtMs: BASE });

    // Pass 1: provider accepts (records the key) and we mark sent.
    const send1 = recordingSender(SENT);
    await processNotificationOutbox({
      now: BASE,
      send: send1,
      leaseOwner: "w1",
    });

    // Simulate the crash window: the local `sent` write was lost, leaving the
    // doc leased-and-expired as a crashed worker would.
    await db
      .collection(NOTIFICATION_OUTBOX_COLLECTION)
      .doc("n6")
      .update({
        state: "processing",
        leaseOwner: "crashed",
        leaseExpiresAt: Timestamp.fromMillis(BASE - 1000),
        sentAt: null,
        providerMessageId: null,
        attemptCount: 0,
      });

    // Pass 2: reclaim + resend. The provider sees the SAME idempotency key, so
    // (within its window) it de-duplicates rather than sending twice. This test
    // proves key reuse; it does NOT assert external exactly-once delivery.
    const send2 = recordingSender(SENT);
    await processNotificationOutbox({
      now: BASE,
      send: send2,
      leaseOwner: "w2",
    });

    expect(send1.keys).toEqual(["delivery-confirmation-req-6"]);
    expect(send2.keys).toEqual(["delivery-confirmation-req-6"]);
    expect((await readOutbox("n6"))!.state).toBe("sent");
  });
});

// --- Permanent / configuration-disabled failures ----------------------------

describe("terminal failures", () => {
  it("marks a permanent provider failure terminal without retry", async () => {
    await seedOutbox("n7", { requestId: "req-7", nextAttemptAtMs: BASE });
    const r = await processNotificationOutbox({
      now: BASE,
      send: recordingSender({
        status: "failed",
        category: "permanent",
        reason: "validation_error",
      }),
      leaseOwner: "w1",
    });
    expect(r.terminal).toBe(1);
    const doc = (await readOutbox("n7"))!;
    expect(doc.state).toBe("failed");
    expect(doc.attemptCount).toBe(1);
    expect(doc.failureCategory).toBe("permanent");
  });

  it("marks a configuration-disabled failure terminal (no hammering)", async () => {
    await seedOutbox("n8", { requestId: "req-8", nextAttemptAtMs: BASE });
    const r = await processNotificationOutbox({
      now: BASE,
      send: recordingSender({
        status: "failed",
        category: "configuration_disabled",
        reason: "resend_not_configured",
      }),
      leaseOwner: "w1",
    });
    expect(r.terminal).toBe(1);
    expect((await readOutbox("n8"))!.failureCategory).toBe(
      "configuration_disabled",
    );
  });
});

// --- Admin operator visibility + manual retry -------------------------------

describe("admin manual retry", () => {
  it("lists failed notifications (sanitized) and re-queues one safely", async () => {
    await seedOutbox("n9", {
      requestId: "req-9",
      state: "failed",
      attemptCount: MAX_ATTEMPTS,
    });
    await db
      .collection(NOTIFICATION_OUTBOX_COLLECTION)
      .doc("n9")
      .update({ failureCategory: "max_attempts", failureReason: "rate_limit" });

    const failed = await listNotificationsByState("failed", 50);
    expect(failed.map((f) => f.id)).toContain("n9");
    // Sanitized: no recipient email / body fields on the entry.
    expect(Object.keys(failed[0])).not.toContain("email");

    const result = await retryFailedNotification("n9");
    expect(result).toEqual({ ok: true });
    const doc = (await readOutbox("n9"))!;
    expect(doc.state).toBe("pending");
    expect(doc.attemptCount).toBe(0);
    expect(doc.failureCategory).toBeNull();
  });

  it("never re-queues a sent notification and reports missing ones", async () => {
    await seedOutbox("n10", {
      requestId: "req-10",
      state: "sent",
      sentAtMs: BASE,
    });
    expect(await retryFailedNotification("n10")).toEqual({
      ok: false,
      reason: "already_sent",
    });
    expect((await readOutbox("n10"))!.state).toBe("sent");

    expect(await retryFailedNotification("does-not-exist")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
