import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Transaction } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { appConfig } from "@/lib/domain/config";
import {
  getDispatchSettings,
  updateDispatchSettings,
} from "@/lib/domain/dispatchSettings";

/**
 * Emulator-backed regression tests for issue #49 — dispatch settings.
 *
 * `updateDispatchSettings` previously (a) wrote the config document and then
 * appended its `dispatch_settings_updated` audit event in a SEPARATE write, so
 * the config could commit without its required audit event, and (b) read the
 * `oldValues` OUTSIDE the mutation, so concurrent updates could record an audit
 * event whose `oldValues` did not describe the state that update actually
 * replaced. The fix commits the config write and the audit event in ONE
 * transaction and derives `oldValues` from a read INSIDE that transaction.
 *
 * Runs only under `npm run test:rules`; excluded from the plain `vitest` run.
 */

const db = getAdminDb();
const CONFIG = "config";
const DOC = "dispatchSettings";

function settingsRef() {
  return db.collection(CONFIG).doc(DOC);
}

async function eventDocs() {
  const snap = await settingsRef().collection("events").get();
  return snap.docs.map((d) => d.data());
}

async function configData(): Promise<Record<string, unknown> | undefined> {
  const snap = await settingsRef().get();
  return snap.exists ? snap.data() : undefined;
}

async function clearState(): Promise<void> {
  await db.recursiveDelete(db.collection(CONFIG));
}

/**
 * Wraps the NEXT `db.runTransaction` so the domain function's transaction body
 * runs and stages all its writes, then the transaction is aborted before
 * commit. With an atomic implementation this must leave NOTHING behind (neither
 * the config mutation nor the audit event); a non-atomic implementation that
 * committed the config before appending the event would strand a partial write.
 */
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

describe("updateDispatchSettings — atomic config + audit event (#49)", () => {
  it("commits the config and its audit event together, with default oldValues on first write", async () => {
    // No document exists yet: the effective previous values are the code-level
    // defaults, and that is what the audit event must record as oldValues.
    const result = await updateDispatchSettings({
      maxDeclinesPerDay: 5,
      declineCooldownHours: 2,
      actorId: "admin-1",
    });

    expect(result.maxDeclinesPerDay).toBe(5);
    expect(result.declineCooldownHours).toBe(2);

    const config = await configData();
    expect(config?.maxDeclinesPerDay).toBe(5);
    expect(config?.declineCooldownHours).toBe(2);
    expect(config?.updatedBy).toBe("admin-1");

    const events = await eventDocs();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("dispatch_settings_updated");
    expect(events[0].actorId).toBe("admin-1");
    expect(events[0].oldValues).toEqual({
      maxDeclinesPerDay: appConfig.defaultMaxDeclinesPerDay,
      declineCooldownHours: appConfig.defaultDeclineCooldownHours,
    });
    expect(events[0].newValues).toEqual({
      maxDeclinesPerDay: 5,
      declineCooldownHours: 2,
    });
  }, 30_000);

  it("records oldValues from the state it actually replaced on a subsequent update", async () => {
    await updateDispatchSettings({
      maxDeclinesPerDay: 5,
      declineCooldownHours: 2,
      actorId: "admin-1",
    });
    await updateDispatchSettings({
      maxDeclinesPerDay: 8,
      declineCooldownHours: 4,
      actorId: "admin-2",
    });

    const events = (await eventDocs()).sort((a, b) =>
      (a.newValues.maxDeclinesPerDay as number) >
      (b.newValues.maxDeclinesPerDay as number)
        ? 1
        : -1,
    );
    expect(events).toHaveLength(2);
    // Second update's oldValues must be exactly the first update's committed
    // newValues — not a stale/default read.
    expect(events[1].oldValues).toEqual({
      maxDeclinesPerDay: 5,
      declineCooldownHours: 2,
    });
    expect(events[1].newValues).toEqual({
      maxDeclinesPerDay: 8,
      declineCooldownHours: 4,
    });
  }, 30_000);

  it("leaves neither a partial config mutation nor a misleading event when the transaction fails", async () => {
    // Establish a known committed baseline.
    await updateDispatchSettings({
      maxDeclinesPerDay: 5,
      declineCooldownHours: 2,
      actorId: "admin-1",
    });
    const baselineEventCount = (await eventDocs()).length;

    // The next update stages its writes then the transaction is aborted.
    const injected = failNextTransactionAfterStaging();
    try {
      await expect(
        updateDispatchSettings({
          maxDeclinesPerDay: 9,
          declineCooldownHours: 9,
          actorId: "admin-evil",
        }),
      ).rejects.toThrow("INJECTED_TXN_FAILURE");
    } finally {
      injected.restore();
    }

    // Config is unchanged (no partial mutation)...
    const config = await configData();
    expect(config?.maxDeclinesPerDay).toBe(5);
    expect(config?.declineCooldownHours).toBe(2);
    expect(config?.updatedBy).toBe("admin-1");

    // ...and no misleading audit event was written.
    const events = await eventDocs();
    expect(events).toHaveLength(baselineEventCount);
    expect(
      events.some((e) => (e.newValues?.maxDeclinesPerDay as number) === 9),
    ).toBe(false);
  }, 30_000);

  it("serializes concurrent updates so each event's oldValues chains from committed state", async () => {
    // Two concurrent updates from a fresh (defaults) baseline. Both read AND
    // write the single config document, so Firestore serializes them; the
    // loser retries and must observe the winner's committed values as its
    // oldValues — never a stale pre-transaction read shared by both.
    const [a, b] = await Promise.allSettled([
      updateDispatchSettings({
        maxDeclinesPerDay: 5,
        declineCooldownHours: 2,
        actorId: "admin-a",
      }),
      updateDispatchSettings({
        maxDeclinesPerDay: 8,
        declineCooldownHours: 4,
        actorId: "admin-b",
      }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");

    const events = await eventDocs();
    expect(events).toHaveLength(2);

    const defaults = {
      maxDeclinesPerDay: appConfig.defaultMaxDeclinesPerDay,
      declineCooldownHours: appConfig.defaultDeclineCooldownHours,
    };
    // Exactly one event started from the defaults (the first to commit).
    const fromDefaults = events.filter(
      (e) =>
        e.oldValues.maxDeclinesPerDay === defaults.maxDeclinesPerDay &&
        e.oldValues.declineCooldownHours === defaults.declineCooldownHours,
    );
    expect(fromDefaults).toHaveLength(1);

    // The other event's oldValues equal the first event's committed newValues:
    // the audit chain is a consistent history, proving no stale oldValues read.
    const second = events.find((e) => e !== fromDefaults[0])!;
    expect(second.oldValues).toEqual(fromDefaults[0].newValues);

    // Final committed config equals the terminal event's newValues.
    const config = await configData();
    expect(config?.maxDeclinesPerDay).toBe(second.newValues.maxDeclinesPerDay);
    expect(config?.declineCooldownHours).toBe(
      second.newValues.declineCooldownHours,
    );
  }, 30_000);
});
