import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminDb } from "@/lib/firebase/admin";
import {
  createWaterRequest,
  getActiveRequestForCustomer,
} from "@/lib/domain/waterRequests";

/**
 * Emulator-backed tests for the transactional one-active-request rule in
 * `createWaterRequest()`. The e2e and cancellation suites prove the slot
 * lifecycle end-to-end; these tests prove the TRANSACTION enforces the
 * invariant against committed state — including under concurrent submits —
 * and that the deliberately different treatment of unregistered customers
 * (soft duplicate check only, see `findActiveRequestsByPhone`) is the
 * behavior that actually ships.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest`
 * run.
 */

const db = getAdminDb();
const REQUESTS = "waterRequests";

const RESIDENT = "resident-uid-1";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: RESIDENT,
    loads: 1 as const,
    village: "Windwardside",
    deliveryDirections: "Blue gate.",
    customer: {
      displayName: "Resident One",
      phone: "+599 416 0000",
      email: null,
    },
    waterSituation: { reportedUrgency: "normal" as const },
    attestationAccepted: true,
    ...overrides,
  };
}

async function clearState(): Promise<void> {
  await db.recursiveDelete(db.collection(REQUESTS));
}

beforeEach(clearState);
afterAll(clearState);

describe("createWaterRequest — one-active-request rule", () => {
  it("creates the first request and rejects a second while it is active", async () => {
    const first = await createWaterRequest(baseInput());
    expect(first.status).toBe("available");

    await expect(createWaterRequest(baseInput())).rejects.toThrow(
      "DUPLICATE_ACTIVE_REQUEST",
    );

    // Exactly one request document exists.
    const snap = await db.collection(REQUESTS).get();
    expect(snap.size).toBe(1);
  }, 30_000);

  it.each(["claimed", "delivered", "disputed", "preferred_driver_hold"])(
    "still rejects a new request while the existing one is %s",
    async (status) => {
      const first = await createWaterRequest(baseInput());
      await db.collection(REQUESTS).doc(first.id).update({ status });

      await expect(createWaterRequest(baseInput())).rejects.toThrow(
        "DUPLICATE_ACTIVE_REQUEST",
      );
    },
    30_000,
  );

  it("allows a new request once the previous one is cancelled", async () => {
    const first = await createWaterRequest(baseInput());
    await db.collection(REQUESTS).doc(first.id).update({ status: "cancelled" });

    const second = await createWaterRequest(baseInput());
    expect(second.id).not.toBe(first.id);
    expect(await getActiveRequestForCustomer(RESIDENT)).not.toBeNull();
  }, 30_000);

  it("lets exactly one of two concurrent creates win the active slot", async () => {
    const results = await Promise.allSettled([
      createWaterRequest(baseInput()),
      createWaterRequest(baseInput()),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      "DUPLICATE_ACTIVE_REQUEST",
    );

    const snap = await db.collection(REQUESTS).get();
    expect(snap.size).toBe(1);
  }, 30_000);

  it("does not hard-block unregistered customers (customerId null) — soft check is caller-side by design", async () => {
    const unregisteredInput = {
      ...baseInput(),
      customerId: null,
      source: "dispatcher" as const,
      createdBy: "dispatcher-uid-1",
      customer: {
        displayName: "Walk-in Customer",
        phone: "+599 416 5555",
        email: null,
      },
    };

    const first = await createWaterRequest(unregisteredInput);
    const second = await createWaterRequest(unregisteredInput);
    expect(first.id).not.toBe(second.id);

    const snap = await db.collection(REQUESTS).get();
    expect(snap.size).toBe(2);
  }, 30_000);

  it("enforces the rule for a dispatcher-created request on behalf of a registered resident too", async () => {
    await createWaterRequest(baseInput());

    await expect(
      createWaterRequest({
        ...baseInput(),
        source: "dispatcher" as const,
        createdBy: "dispatcher-uid-1",
      }),
    ).rejects.toThrow("DUPLICATE_ACTIVE_REQUEST");
  }, 30_000);
});
