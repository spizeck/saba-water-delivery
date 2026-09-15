import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { type Transaction, Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  getMergeReconciliationOverview,
  listUnresolvedMergeReconciliations,
  MERGE_EVENTS_COLLECTION,
  processMergeAuthReconciliation,
  reconcileMergeAuthEvent,
  retryMergeReconciliation,
  type MergeAuthOps,
} from "@/lib/domain/mergeReconciliation";
import {
  MERGE_AUTH_LEASE_DURATION_MS,
  MERGE_AUTH_LEGACY_SCAN_LIMIT,
  MERGE_AUTH_WORKER_BATCH_LIMIT,
} from "@/lib/domain/mergeReconciliationPolicy";
import type { UserRole } from "@/lib/domain/types";

/**
 * Emulator-backed tests for the durable account-merge Auth reconciliation
 * state machine (issue #73): claim/lease/backoff/terminal/idempotency/
 * reclamation/manual-retry semantics against a REAL Firestore, with the Auth
 * operations injected as a deterministic fake — this file deliberately does
 * NOT need the Auth emulator; it isolates the durable state machine.
 * Real-Auth behavior (enable/disable/delete/revoke and the session boundary)
 * is covered by mergeAuthReconciliation.auth-emulator.test.ts under
 * `npm run test:auth-emulator`.
 *
 * Runs only under `npm run test:rules`.
 */

const db = getAdminDb();
const USERS = "users";
const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);
const ZERO_JITTER = () => 0.5;

async function clearState(): Promise<void> {
  for (const c of [USERS, MERGE_EVENTS_COLLECTION]) {
    await db.recursiveDelete(db.collection(c));
  }
}

function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

interface FakeAuthUser {
  disabled: boolean;
}

interface FakeAuthFailure {
  op: "getUser" | "disableUser" | "revokeRefreshTokens" | "deleteUser";
  /** Throw only on these 1-based call ordinals; omitted = always. */
  calls?: number[];
  error: Error;
}

/**
 * Deterministic fake of {@link MergeAuthOps}. Records every call (op + uid)
 * so tests can assert ordering and that the canonical uid is never touched.
 */
function makeFakeAuth(
  users: Record<string, FakeAuthUser>,
  failures: FakeAuthFailure[] = [],
): { ops: MergeAuthOps; calls: Array<{ op: string; uid: string }> } {
  const calls: Array<{ op: string; uid: string }> = [];
  const ordinals = new Map<string, number>();
  const bump = (op: string) => {
    const n = (ordinals.get(op) ?? 0) + 1;
    ordinals.set(op, n);
    return n;
  };
  const maybeThrow = (op: FakeAuthFailure["op"]) => {
    const n = ordinals.get(op) ?? 0;
    const failure = failures.find(
      (f) => f.op === op && (!f.calls || f.calls.includes(n)),
    );
    if (failure) throw failure.error;
  };
  const ops: MergeAuthOps = {
    async getUser(uid) {
      bump("getUser");
      calls.push({ op: "getUser", uid });
      maybeThrow("getUser");
      const u = users[uid];
      if (!u) throw authError("auth/user-not-found");
      return { disabled: u.disabled };
    },
    async disableUser(uid) {
      bump("disableUser");
      calls.push({ op: "disableUser", uid });
      maybeThrow("disableUser");
      const u = users[uid];
      if (!u) throw authError("auth/user-not-found");
      u.disabled = true;
    },
    async revokeRefreshTokens(uid) {
      bump("revokeRefreshTokens");
      calls.push({ op: "revokeRefreshTokens", uid });
      maybeThrow("revokeRefreshTokens");
      if (!users[uid]) throw authError("auth/user-not-found");
    },
    async deleteUser(uid) {
      bump("deleteUser");
      calls.push({ op: "deleteUser", uid });
      maybeThrow("deleteUser");
      const u = users[uid];
      if (!u) throw authError("auth/user-not-found");
      delete users[uid];
    },
  };
  return { ops, calls };
}

interface SeedEventOverrides {
  canonicalUserId?: string;
  duplicateUserId?: string;
  duplicateAuthDeleted?: boolean;
  /** Omit the sub-record entirely to simulate a legacy pre-#73 record. */
  legacy?: boolean;
  /** `createdAt` ordering value — legacy records predate modern ones. */
  createdAtMs?: number;
  state?: string;
  attemptCount?: number;
  nextAttemptAtMs?: number | null;
  leaseOwner?: string | null;
  leaseExpiresAtMs?: number | null;
  lastFailureCategory?: string | null;
}

async function seedMergeEvent(
  eventId: string,
  overrides: SeedEventOverrides = {},
): Promise<void> {
  const data: Record<string, unknown> = {
    canonicalUserId: overrides.canonicalUserId ?? "canon",
    duplicateUserId: overrides.duplicateUserId ?? "dup",
    actorId: "admin-1",
    createdAt: new Date(overrides.createdAtMs ?? BASE).toISOString(),
    reason: "test merge",
    roleMergePolicy: "union",
    mergedRoles: ["resident"],
    duplicateAuthDeleted: overrides.duplicateAuthDeleted ?? false,
    counts: { requestsRelinked: 0, driverRegistryRelinked: 0 },
    error: overrides.lastFailureCategory ?? null,
  };
  if (!overrides.legacy) {
    data.authReconciliation = {
      // Real reconciled records always carry state "reconciled" alongside the
      // deleted flag; default the seed the same way so overview counts stay
      // honest.
      state:
        overrides.state ??
        ((overrides.duplicateAuthDeleted ?? false) ? "reconciled" : "pending"),
      attemptCount: overrides.attemptCount ?? 0,
      nextAttemptAt:
        overrides.nextAttemptAtMs === null
          ? null
          : Timestamp.fromMillis(overrides.nextAttemptAtMs ?? BASE),
      lastAttemptAt: null,
      lastFailureCategory: overrides.lastFailureCategory ?? null,
      duplicateDisabled: false,
      reconciledAt: null,
      leaseOwner: overrides.leaseOwner ?? null,
      leaseExpiresAt:
        overrides.leaseExpiresAtMs == null
          ? null
          : Timestamp.fromMillis(overrides.leaseExpiresAtMs),
    };
  }
  await db.collection(MERGE_EVENTS_COLLECTION).doc(eventId).set(data);
}

async function eventData(eventId: string) {
  const snap = await db.collection(MERGE_EVENTS_COLLECTION).doc(eventId).get();
  return snap.data()!;
}

async function seedUser(uid: string, roles: UserRole[] = ["resident"]) {
  await db
    .collection(USERS)
    .doc(uid)
    .set({
      displayName: `Name ${uid}`,
      email: `${uid}@example.test`,
      roles,
      authStatus: "claimed",
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE),
    });
}

async function failNthTransaction(n: number): Promise<{ restore: () => void }> {
  const real = db.runTransaction.bind(db);
  let calls = 0;
  const spy = vi.spyOn(db, "runTransaction").mockImplementation(((
    updateFn: (txn: Transaction) => Promise<unknown>,
  ) => {
    calls += 1;
    if (calls === n) {
      return real(async (txn) => {
        await updateFn(txn);
        throw new Error("INJECTED_TXN_FAILURE");
      });
    }
    return real(updateFn);
  }) as typeof db.runTransaction);
  return { restore: () => spy.mockRestore() };
}

beforeEach(clearState);
afterEach(clearState);

describe("reconcileMergeAuthEvent — single record lifecycle", () => {
  it("reconciles a pending record: disable → revoke → delete, then terminal state", async () => {
    await seedMergeEvent("e1");
    const { ops, calls } = makeFakeAuth({ dup: { disabled: false } });

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
      leaseOwner: "w1",
    });

    expect(outcome.status).toBe("reconciled");
    expect(calls.map((c) => c.op)).toEqual([
      "getUser",
      "disableUser",
      "revokeRefreshTokens",
      "deleteUser",
    ]);
    // Only the merged-away uid was ever touched.
    expect(new Set(calls.map((c) => c.uid))).toEqual(new Set(["dup"]));

    const data = await eventData("e1");
    expect(data.duplicateAuthDeleted).toBe(true);
    expect(data.error).toBeNull();
    const rec = data.authReconciliation;
    expect(rec.state).toBe("reconciled");
    expect(rec.attemptCount).toBe(1);
    expect(rec.reconciledAt).toBeTruthy();
    expect(rec.leaseOwner).toBeNull();
    expect(rec.leaseExpiresAt).toBeNull();
    expect(rec.nextAttemptAt).toBeNull();
  });

  it("treats auth/user-not-found as idempotent success (crash-after-delete convergence)", async () => {
    await seedMergeEvent("e1");
    const { ops } = makeFakeAuth({}); // duplicate already absent

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(outcome.status).toBe("reconciled");
    const data = await eventData("e1");
    expect(data.duplicateAuthDeleted).toBe(true);
    expect(data.authReconciliation.state).toBe("reconciled");
  });

  it("continues safely when the duplicate is already disabled", async () => {
    await seedMergeEvent("e1");
    const { ops, calls } = makeFakeAuth({ dup: { disabled: true } });

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(outcome.status).toBe("reconciled");
    expect(calls.map((c) => c.op)).toEqual([
      "getUser",
      "revokeRefreshTokens",
      "deleteUser",
    ]);
    expect(calls.some((c) => c.op === "disableUser")).toBe(false);
  });

  it("leaves the duplicate disabled and retryable when disable succeeds but delete fails", async () => {
    await seedMergeEvent("e1");
    const { ops } = makeFakeAuth({ dup: { disabled: false } }, [
      {
        op: "deleteUser",
        error: authError("auth/internal-error"),
      },
    ]);

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });

    expect(outcome.status).toBe("retry_scheduled");
    const data = await eventData("e1");
    const rec = data.authReconciliation;
    expect(rec.state).toBe("pending");
    expect(rec.attemptCount).toBe(1);
    expect(rec.lastFailureCategory).toBe("transient");
    expect(rec.duplicateDisabled).toBe(true); // disabled-but-not-deleted, safely
    expect(rec.nextAttemptAt.toMillis()).toBeGreaterThan(BASE);
    expect(rec.leaseOwner).toBeNull();
    expect(data.error).toBe("transient");
    expect(data.duplicateAuthDeleted).toBe(false);
  });

  it("does not attempt before nextAttemptAt (bounded backoff)", async () => {
    await seedMergeEvent("e1", { nextAttemptAtMs: BASE + 60_000 });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const early = await reconcileMergeAuthEvent("e1", {
      now: BASE + 30_000,
      auth: ops,
    });
    expect(early.status).toBe("skipped");

    const due = await reconcileMergeAuthEvent("e1", {
      now: BASE + 61_000,
      auth: ops,
    });
    expect(due.status).toBe("reconciled");
  });

  it("reclaims a stale processing lease left by a crashed worker", async () => {
    await seedMergeEvent("e1", {
      state: "processing",
      leaseOwner: "dead-worker",
      leaseExpiresAtMs: BASE - 1, // expired
      attemptCount: 1,
    });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      leaseOwner: "new-worker",
    });
    expect(outcome.status).toBe("reconciled");
    expect((await eventData("e1")).authReconciliation.state).toBe("reconciled");
  });

  it("an active lease blocks a concurrent reconciler", async () => {
    await seedMergeEvent("e1", {
      state: "processing",
      leaseOwner: "other-worker",
      leaseExpiresAtMs: BASE + MERGE_AUTH_LEASE_DURATION_MS,
    });
    const { ops, calls } = makeFakeAuth({ dup: { disabled: false } });

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE,
      auth: ops,
      leaseOwner: "us",
    });
    expect(outcome.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("two simultaneous reconcilers do not duplicate Auth operations", async () => {
    await seedMergeEvent("e1");
    const { ops, calls } = makeFakeAuth({ dup: { disabled: false } });

    const [a, b] = await Promise.all([
      reconcileMergeAuthEvent("e1", { now: BASE, auth: ops, leaseOwner: "A" }),
      reconcileMergeAuthEvent("e1", { now: BASE, auth: ops, leaseOwner: "B" }),
    ]);
    const statuses = [a.status, b.status];
    // Exactly one performed the Auth work. The loser is either lease-blocked
    // ("skipped") or — if the winner finished before the loser's claim
    // transaction ran — observes the already-reconciled record. Both are
    // safe; what matters is no duplicate Auth operations.
    expect(statuses.filter((s) => s === "reconciled")).toHaveLength(1);
    expect(
      statuses.filter((s) => s === "skipped" || s === "already_resolved"),
    ).toHaveLength(1);
    expect(calls.filter((c) => c.op === "deleteUser")).toHaveLength(1);
    expect((await eventData("e1")).authReconciliation.state).toBe("reconciled");
  });

  it("converges after the outcome write fails post-delete (crash boundary D)", async () => {
    await seedMergeEvent("e1");
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    // Fail the SECOND transaction (the outcome write) after the Auth delete
    // already succeeded — simulates the process dying at that boundary.
    const injected = await failNthTransaction(2);
    let outcome;
    try {
      outcome = await reconcileMergeAuthEvent("e1", {
        now: BASE,
        auth: ops,
        leaseOwner: "w1",
      });
    } finally {
      injected.restore();
    }
    expect(outcome.status).toBe("error");
    // The record still shows processing (the lease was never released).
    const mid = await eventData("e1");
    expect(mid.authReconciliation.state).toBe("processing");
    expect(mid.duplicateAuthDeleted).toBe(false);

    // After the lease expires, a fresh attempt sees the already-deleted
    // identity (user-not-found) and converges to reconciled.
    const retry = await reconcileMergeAuthEvent("e1", {
      now: BASE + MERGE_AUTH_LEASE_DURATION_MS + 1,
      auth: ops,
      leaseOwner: "w2",
    });
    expect(retry.status).toBe("reconciled");
    expect((await eventData("e1")).duplicateAuthDeleted).toBe(true);
  });

  it("marks a malformed merge record terminally failed without Auth calls", async () => {
    await db
      .collection(MERGE_EVENTS_COLLECTION)
      .doc("bad")
      .set({
        canonicalUserId: "same",
        duplicateUserId: "same",
        duplicateAuthDeleted: false,
        createdAt: new Date(BASE).toISOString(),
      });
    const { ops, calls } = makeFakeAuth({});

    const outcome = await reconcileMergeAuthEvent("bad", {
      now: BASE,
      auth: ops,
    });
    expect(outcome.status).toBe("invalid_record");
    expect(calls).toHaveLength(0);
    const data = await eventData("bad");
    expect(data.authReconciliation.state).toBe("failed");
    expect(data.authReconciliation.lastFailureCategory).toBe("invalid_record");
  });

  it("a failed record is not auto-claimed — it stays terminal until retried", async () => {
    await seedMergeEvent("e1", {
      state: "failed",
      attemptCount: 7,
      lastFailureCategory: "max_attempts",
    });
    const { ops, calls } = makeFakeAuth({ dup: { disabled: false } });

    const outcome = await reconcileMergeAuthEvent("e1", {
      now: BASE + 999_999,
      auth: ops,
    });
    expect(outcome.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("backfills the mergedIntoUserId marker on legacy records", async () => {
    // A merge record written before issue #73: no sub-record, and the
    // duplicate's profile lacks the marker.
    await seedMergeEvent("legacy", { legacy: true });
    await seedUser("dup");
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const outcome = await reconcileMergeAuthEvent("legacy", {
      now: BASE,
      auth: ops,
    });
    expect(outcome.status).toBe("reconciled");
    const data = await eventData("legacy");
    expect(data.authReconciliation.state).toBe("reconciled");
    const dupDoc = await db.collection(USERS).doc("dup").get();
    expect(dupDoc.data()?.mergedIntoUserId).toBe("canon");
  });
});

describe("processMergeAuthReconciliation — bounded sweep", () => {
  it("discovers and reconciles unresolved work in deterministic order", async () => {
    await seedMergeEvent("e1");
    await seedMergeEvent("e2", { duplicateUserId: "dup2" });
    await seedMergeEvent("e3", { duplicateAuthDeleted: true }); // resolved
    const { ops } = makeFakeAuth({
      dup: { disabled: false },
      dup2: { disabled: false },
    });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });

    expect(result.reconciled).toBe(2);
    expect((await eventData("e1")).authReconciliation.state).toBe("reconciled");
    expect((await eventData("e2")).authReconciliation.state).toBe("reconciled");
  });

  it("retries a transient failure on a later sweep once due", async () => {
    await seedMergeEvent("e1");
    const first = makeFakeAuth({ dup: { disabled: false } }, [
      { op: "deleteUser", calls: [1], error: authError("auth/internal-error") },
    ]);
    const r1 = await processMergeAuthReconciliation({
      now: BASE,
      auth: first.ops,
      rng: ZERO_JITTER,
    });
    expect(r1.retried).toBe(1);

    // Not yet due → not a candidate in any stream (never claimed).
    const r2 = await processMergeAuthReconciliation({
      now: BASE + 30_000,
      auth: makeFakeAuth({}).ops,
      rng: ZERO_JITTER,
    });
    expect(r2.claimed).toBe(0);
    expect(r2.reconciled).toBe(0);

    // Due now → converges.
    const second = makeFakeAuth({ dup: { disabled: true } });
    const r3 = await processMergeAuthReconciliation({
      now: BASE + 90_000,
      auth: second.ops,
      rng: ZERO_JITTER,
    });
    expect(r3.reconciled).toBe(1);
  });

  it("caps the batch at the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await seedMergeEvent(`e${i}`, { duplicateUserId: `dup${i}` });
    }
    const { ops } = makeFakeAuth(
      Object.fromEntries(
        [0, 1, 2, 3, 4].map((i) => [`dup${i}`, { disabled: false }]),
      ),
    );
    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      limit: 2,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(2);
  });
});

describe("processMergeAuthReconciliation — starvation-free selection", () => {
  const INELIGIBLE = MERGE_AUTH_WORKER_BATCH_LIMIT + 5; // > batch limit

  /** Seeds `n` ineligible records OLDER than the due record under test. */
  async function seedIneligibleBacklog(
    n: number,
    state: "failed" | "future" | "processing",
  ) {
    for (let i = 0; i < n; i++) {
      await seedMergeEvent(`old-${state}-${i}`, {
        duplicateUserId: `old-dup-${i}`,
        createdAtMs: BASE - 60_000 - i,
        ...(state === "failed"
          ? {
              state: "failed",
              attemptCount: 7,
              lastFailureCategory: "max_attempts",
              nextAttemptAtMs: null,
            }
          : state === "future"
            ? { state: "pending", nextAttemptAtMs: BASE + 3_600_000 }
            : {
                state: "processing",
                leaseOwner: "other-worker",
                leaseExpiresAtMs: BASE + MERGE_AUTH_LEASE_DURATION_MS,
              }),
      });
    }
  }

  it(">25 terminal failed records cannot starve a later due pending record", async () => {
    await seedIneligibleBacklog(INELIGIBLE, "failed");
    await seedMergeEvent("due", { createdAtMs: BASE });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(1);
    expect((await eventData("due")).authReconciliation.state).toBe(
      "reconciled",
    );
    // The failed backlog was never claimed.
    const failed = await eventData("old-failed-0");
    expect(failed.authReconciliation.state).toBe("failed");
    expect(failed.authReconciliation.attemptCount).toBe(7);
  });

  it(">25 future-backoff pending records cannot starve a due pending record", async () => {
    await seedIneligibleBacklog(INELIGIBLE, "future");
    await seedMergeEvent("due", { createdAtMs: BASE });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(1);
    expect((await eventData("due")).authReconciliation.state).toBe(
      "reconciled",
    );
    // Future work was left alone — still pending, still scheduled.
    expect((await eventData("old-future-0")).authReconciliation.state).toBe(
      "pending",
    );
  });

  it(">25 active processing leases cannot starve a due pending record", async () => {
    await seedIneligibleBacklog(INELIGIBLE, "processing");
    await seedMergeEvent("due", { createdAtMs: BASE });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(1);
    expect((await eventData("due")).authReconciliation.state).toBe(
      "reconciled",
    );
    // Active leases were never touched.
    expect(
      (await eventData("old-processing-0")).authReconciliation.leaseOwner,
    ).toBe("other-worker");
  });

  it("an expired processing lease is reclaimed through the sweep", async () => {
    await seedIneligibleBacklog(INELIGIBLE, "failed");
    await seedMergeEvent("stale", {
      state: "processing",
      leaseOwner: "dead-worker",
      leaseExpiresAtMs: BASE - 1,
      createdAtMs: BASE - 30_000,
    });
    await seedMergeEvent("due", { createdAtMs: BASE });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(2);
    expect((await eventData("stale")).authReconciliation.state).toBe(
      "reconciled",
    );
    expect((await eventData("due")).authReconciliation.state).toBe(
      "reconciled",
    );
  });

  it("legacy records without authReconciliation are discovered ahead of a modern ineligible backlog", async () => {
    // The legacy record predates every modern record (created before #73
    // shipped) — so the bounded createdAt-ordered scan reaches it first.
    await seedMergeEvent("legacy", {
      legacy: true,
      duplicateUserId: "legacy-dup",
      createdAtMs: BASE - 3_600_000,
    });
    await seedIneligibleBacklog(INELIGIBLE, "failed");
    const { ops } = makeFakeAuth({ "legacy-dup": { disabled: false } });

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.reconciled).toBe(1);
    const data = await eventData("legacy");
    expect(data.authReconciliation.state).toBe("reconciled");
    expect(data.duplicateAuthDeleted).toBe(true);
  });

  it("total effort stays bounded under a large mixed backlog", async () => {
    await seedIneligibleBacklog(INELIGIBLE, "failed");
    await seedIneligibleBacklog(INELIGIBLE, "future");
    await seedIneligibleBacklog(INELIGIBLE, "processing");
    // 30 due records → more than one batch limit of REAL work too.
    for (let i = 0; i < INELIGIBLE; i++) {
      await seedMergeEvent(`due-${i}`, {
        duplicateUserId: `due-dup-${i}`,
        createdAtMs: BASE + i,
      });
    }
    const { ops, calls } = makeFakeAuth(
      Object.fromEntries(
        Array.from({ length: INELIGIBLE }, (_, i) => [
          `due-dup-${i}`,
          { disabled: false },
        ]),
      ),
    );

    const result = await processMergeAuthReconciliation({
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    // Claims are capped at the batch limit regardless of backlog size.
    expect(result.claimed).toBe(MERGE_AUTH_WORKER_BATCH_LIMIT);
    expect(result.reconciled).toBe(MERGE_AUTH_WORKER_BATCH_LIMIT);
    expect(calls.filter((c) => c.op === "deleteUser")).toHaveLength(
      MERGE_AUTH_WORKER_BATCH_LIMIT,
    );
    // Reads are bounded: ≤ limit due-pending + ≤ limit expired-lease +
    // ≤ MERGE_AUTH_LEGACY_SCAN_LIMIT scan reads.
    expect(result.scanned).toBeLessThanOrEqual(
      2 * MERGE_AUTH_WORKER_BATCH_LIMIT + MERGE_AUTH_LEGACY_SCAN_LIMIT,
    );
  });
});

describe("retryMergeReconciliation — manual operator retry", () => {
  it("requeues a terminally failed record and attempts it immediately", async () => {
    await seedMergeEvent("e1", {
      state: "failed",
      attemptCount: 7,
      lastFailureCategory: "permission",
    });
    const { ops } = makeFakeAuth({ dup: { disabled: false } });

    const result = await retryMergeReconciliation("e1", {
      now: BASE,
      auth: ops,
      rng: ZERO_JITTER,
    });
    expect(result.status).toBe("attempted");
    if (result.status === "attempted") {
      expect(result.outcome.status).toBe("reconciled");
    }
    expect((await eventData("e1")).authReconciliation.state).toBe("reconciled");
  });

  it("refuses already-reconciled and in-progress work", async () => {
    await seedMergeEvent("done", { duplicateAuthDeleted: true });
    expect((await retryMergeReconciliation("done")).status).toBe(
      "already_reconciled",
    );

    await seedMergeEvent("busy", {
      state: "processing",
      leaseExpiresAtMs: BASE + 60_000,
    });
    expect((await retryMergeReconciliation("busy", { now: BASE })).status).toBe(
      "in_progress",
    );

    expect((await retryMergeReconciliation("missing")).status).toBe(
      "not_found",
    );
  });
});

describe("operator surface", () => {
  it("reports counts and sanitized unresolved entries", async () => {
    await seedMergeEvent("p1"); // pending
    await seedMergeEvent("f1", {
      state: "failed",
      duplicateUserId: "dup-f",
      lastFailureCategory: "max_attempts",
    });
    await seedMergeEvent("proc", {
      state: "processing",
      duplicateUserId: "dup-p",
      leaseExpiresAtMs: BASE + 60_000,
    });
    await seedMergeEvent("stale", {
      state: "processing",
      duplicateUserId: "dup-s",
      leaseExpiresAtMs: BASE - 1,
    });
    await seedMergeEvent("done", { duplicateAuthDeleted: true });
    await seedMergeEvent("legacy", {
      legacy: true,
      duplicateUserId: "dup-l",
    });

    const overview = await getMergeReconciliationOverview(BASE);
    expect(overview.pending).toBe(1);
    expect(overview.processing).toBe(1);
    expect(overview.staleProcessing).toBe(1);
    expect(overview.failed).toBe(1);
    expect(overview.unresolved).toBe(5); // pending+processing+stale+failed+legacy

    const entries = await listUnresolvedMergeReconciliations();
    expect(entries.map((e) => e.eventId).sort()).toEqual([
      "f1",
      "legacy",
      "p1",
      "proc",
      "stale",
    ]);
    // Sanitized: failure category only, never a provider payload.
    const failed = entries.find((e) => e.eventId === "f1")!;
    expect(failed.lastFailureCategory).toBe("max_attempts");
    expect(failed.state).toBe("failed");
    // Legacy records surface as pending.
    expect(entries.find((e) => e.eventId === "legacy")!.state).toBe("pending");
  });
});
