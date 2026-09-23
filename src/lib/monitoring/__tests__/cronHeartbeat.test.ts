import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Deterministic FieldValue sentinels so the fake Firestore can interpret them.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    increment: (n: number) => ({ __sentinel: "increment", n }),
  },
}));

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  getLogger: () => mocks,
  serializeError: (e: unknown) => String(e),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: vi.fn(() => {
    throw new Error("no admin app in unit tests");
  }),
}));

import {
  CRON_EXPECTATIONS,
  evaluateHeartbeat,
  getCronHeartbeatStatuses,
  recordCronHeartbeat,
  runCronWatchdog,
  type CronHeartbeatDoc,
} from "../cronHeartbeat";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const ts = (d: Date) => ({ toDate: () => d });

/** Minimal in-memory Firestore double honoring merge + sentinels. */
function makeFakeDb(seed: Record<string, CronHeartbeatDoc> = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(seed).map(([k, v]) => [k, { ...v }]),
  );
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: store.has(id),
          data: () => store.get(id),
        }),
        set: async (data: Record<string, unknown>) => {
          const cur = store.get(id) ?? {};
          const next = { ...cur };
          for (const [key, value] of Object.entries(data)) {
            if (
              value &&
              typeof value === "object" &&
              "__sentinel" in value &&
              (value as { __sentinel: string }).__sentinel === "serverTimestamp"
            ) {
              next[key] = ts(NOW);
            } else if (
              value &&
              typeof value === "object" &&
              "__sentinel" in value &&
              (value as { __sentinel: string }).__sentinel === "increment"
            ) {
              next[key] =
                Number(next[key] ?? 0) + (value as unknown as { n: number }).n;
            } else {
              next[key] = value;
            }
          }
          store.set(id, next);
        },
      }),
    }),
  };
  return { db: db as never, store };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateHeartbeat", () => {
  const expectation = CRON_EXPECTATIONS["notifications"];

  it("treats a never-recorded cron as stale", () => {
    expect(evaluateHeartbeat(null, expectation, NOW)).toEqual({
      stale: true,
      ageMs: null,
    });
  });

  it("treats a recent success as fresh", () => {
    const doc: CronHeartbeatDoc = {
      cron: "notifications",
      lastSuccessAt: ts(new Date(NOW.getTime() - 10 * 60 * 1000)),
    };
    expect(evaluateHeartbeat(doc, expectation, NOW).stale).toBe(false);
  });

  it("treats a success older than the threshold as stale", () => {
    const doc: CronHeartbeatDoc = {
      cron: "notifications",
      lastSuccessAt: ts(new Date(NOW.getTime() - 2 * 60 * 60 * 1000)),
    };
    const result = evaluateHeartbeat(doc, expectation, NOW);
    expect(result.stale).toBe(true);
    expect(result.ageMs).toBe(2 * 60 * 60 * 1000);
  });
});

describe("recordCronHeartbeat", () => {
  it("records success timestamps and resets the failure counter", async () => {
    const { db, store } = makeFakeDb({
      "continuity-report": {
        cron: "continuity-report",
        consecutiveFailures: 3,
      },
    });
    await recordCronHeartbeat("continuity-report", "success", db);
    const doc = store.get("continuity-report")!;
    expect(doc.lastStatus).toBe("success");
    expect(doc.consecutiveFailures).toBe(0);
    expect((doc.lastSuccessAt as { toDate(): Date }).toDate()).toEqual(NOW);
    expect((doc.lastAttemptAt as { toDate(): Date }).toDate()).toEqual(NOW);
  });

  it("records a failure without touching lastSuccessAt", async () => {
    const previousSuccess = new Date(NOW.getTime() - 60 * 60 * 1000);
    const { db, store } = makeFakeDb({
      notifications: {
        cron: "notifications",
        lastSuccessAt: ts(previousSuccess),
        consecutiveFailures: 1,
      },
    });
    await recordCronHeartbeat("notifications", "failure", db);
    const doc = store.get("notifications")!;
    expect(doc.lastStatus).toBe("failure");
    expect(doc.consecutiveFailures).toBe(2);
    expect((doc.lastSuccessAt as { toDate(): Date }).toDate()).toEqual(
      previousSuccess,
    );
  });

  it("never throws when the write fails", async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          set: async () => {
            throw new Error("firestore down");
          },
        }),
      }),
    };
    await expect(
      recordCronHeartbeat("notifications", "success", db as never),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith(
      "cron.heartbeat.record_failed",
      expect.objectContaining({ cron: "notifications" }),
    );
  });
});

describe("runCronWatchdog", () => {
  it("logs cron.heartbeat.stale for a cron with no recorded success", async () => {
    const { db } = makeFakeDb();
    const statuses = await runCronWatchdog(NOW, db);
    expect(statuses.every((s) => s.stale)).toBe(true);
    expect(
      mocks.error.mock.calls.filter(
        ([event]) => event === "cron.heartbeat.stale",
      ),
    ).toHaveLength(Object.keys(CRON_EXPECTATIONS).length);
  });

  it("does not log for a fresh cron", async () => {
    const seed = Object.fromEntries(
      Object.keys(CRON_EXPECTATIONS).map((cron) => [
        cron,
        { cron, lastSuccessAt: ts(new Date(NOW.getTime() - 5 * 60 * 1000)) },
      ]),
    );
    const { db } = makeFakeDb(seed);
    await runCronWatchdog(NOW, db);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("deduplicates stale alerts within the cooldown window", async () => {
    const { db, store } = makeFakeDb({
      "continuity-report": {
        cron: "continuity-report",
        lastSuccessAt: ts(new Date(NOW.getTime() - 30 * 60 * 60 * 1000)),
        lastStaleAlertAt: ts(new Date(NOW.getTime() - 60 * 60 * 1000)),
      },
    });
    await runCronWatchdog(NOW, db);
    const staleCalls = mocks.error.mock.calls.filter(
      ([event]) => event === "cron.heartbeat.stale",
    );
    // continuity-report is still inside its 4h alert cooldown.
    expect(
      staleCalls.filter(([, ctx]) => ctx.cron === "continuity-report"),
    ).toHaveLength(0);
    expect(store.get("continuity-report")!.lastStaleAlertAt).toBeDefined();
  });

  it("re-logs after the cooldown expires and restamps lastStaleAlertAt", async () => {
    const { db, store } = makeFakeDb({
      "continuity-report": {
        cron: "continuity-report",
        lastSuccessAt: ts(new Date(NOW.getTime() - 30 * 60 * 60 * 1000)),
        lastStaleAlertAt: ts(new Date(NOW.getTime() - 5 * 60 * 60 * 1000)),
      },
    });
    await runCronWatchdog(NOW, db);
    const staleCalls = mocks.error.mock.calls.filter(
      ([event, ctx]) =>
        event === "cron.heartbeat.stale" && ctx.cron === "continuity-report",
    );
    expect(staleCalls).toHaveLength(1);
    expect(
      (
        store.get("continuity-report")!.lastStaleAlertAt as { toDate(): Date }
      ).toDate(),
    ).toEqual(NOW);
  });
});

describe("getCronHeartbeatStatuses", () => {
  it("returns sanitized categorical status for every registered cron", async () => {
    const { db } = makeFakeDb({
      notifications: {
        cron: "notifications",
        lastAttemptAt: ts(new Date(NOW.getTime() - 5 * 60 * 1000)),
        lastSuccessAt: ts(new Date(NOW.getTime() - 5 * 60 * 1000)),
        lastStatus: "success",
      },
    });
    const statuses = await getCronHeartbeatStatuses(NOW, db);
    expect(statuses).toHaveLength(Object.keys(CRON_EXPECTATIONS).length);
    const notifications = statuses.find((s) => s.cron === "notifications")!;
    expect(notifications.stale).toBe(false);
    expect(notifications.lastSuccessAt).toBe("2026-09-25T11:55:00.000Z");
    // Never-recorded crons are stale with null timestamps — no internals leak.
    const continuity = statuses.find((s) => s.cron === "continuity-report")!;
    expect(continuity.stale).toBe(true);
    expect(continuity.lastSuccessAt).toBeNull();
  });
});
