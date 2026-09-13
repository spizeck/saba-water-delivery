import { describe, expect, it } from "vitest";

import { runIntegrityChecks } from "../recovery-checks.mjs";
import {
  assembleDataset,
  computeExitCode,
  makeFirestoreReader,
  runDiagnosticScan,
} from "../integrity-scan.mjs";

/**
 * Tests for the bounded, read-only scan layer (issue #52):
 *   - `assembleDataset` operational vs full-scan behavior, referenced-doc
 *     resolution (so pagination cannot cause false "missing" findings),
 *     budget-bounded referenced backfill, and truncation reporting — exercised
 *     with a fake reader.
 *   - `makeFirestoreReader` is provably READ-ONLY: driven against a fake db
 *     whose every write method throws, the scan completes using only reads.
 *   - `runDiagnosticScan` maps a scan/read/target failure to exit 2 (config/
 *     target/auth failure) rather than to a finding (exit 1) or a crash.
 *   - `computeExitCode` contract.
 */

// --- Fake reader (matches the makeFirestoreReader interface) ----------------

type FakeDoc = { id: string; [k: string]: unknown };
type FakeData = Record<string, FakeDoc[]>;

function fakeReader(
  data: FakeData,
  { truncated = {} }: { truncated?: Record<string, boolean> } = {},
) {
  const calls: {
    paginate: { name: string }[];
    queryByStatusIn: { name: string }[];
    getByIds: { name: string; ids: string[] }[];
  } = { paginate: [], queryByStatusIn: [], getByIds: [] };
  return {
    calls,
    async paginate(name: string) {
      calls.paginate.push({ name });
      return {
        docs: (data[name] ?? []).map((d) => ({ ...d })),
        truncated: Boolean(truncated[name]),
      };
    },
    async queryByStatusIn(name: string, statuses: string[]) {
      calls.queryByStatusIn.push({ name });
      const docs = (data[name] ?? [])
        .filter((d) => statuses.includes(d.status as string))
        .map((d) => ({ ...d }));
      return { docs, truncated: Boolean(truncated[name]) };
    },
    async getByIds(name: string, ids: string[]) {
      calls.getByIds.push({ name, ids });
      const byId = new Map((data[name] ?? []).map((d) => [d.id, d] as const));
      return ids
        .map((id) => byId.get(id))
        .filter((d): d is FakeDoc => Boolean(d))
        .map((d) => ({ ...d }));
    },
  };
}

describe("assembleDataset", () => {
  const data = {
    driverRegistry: [
      { id: "reg-1", linkedUserId: "d1", activeRequestId: "req-terminal" },
    ],
    users: [{ id: "u1", roles: ["resident"] }],
    dispatchBatches: [
      {
        id: "b1",
        originalRequestIds: ["req-active", "req-hist"],
        status: "active",
      },
    ],
    waterRequests: [
      { id: "req-active", status: "claimed", assignedDriverId: "d1" },
      { id: "req-terminal", status: "confirmed", assignedDriverId: "d1" }, // terminal, referenced by a driver lock
      { id: "req-hist", status: "cancelled", assignedDriverId: null }, // terminal, referenced by a batch
    ],
  };

  it("operational mode queries active requests and resolves referenced terminal ones", async () => {
    const reader = fakeReader(data);
    const { dataset, scan } = await assembleDataset(reader, {});

    expect(scan.mode).toBe("operational");
    expect(scan.scanStatus).toBe("operational");
    // Requests loaded: the active one + terminal ones resolved by reference
    // (driver.activeRequestId and batch.originalRequestIds).
    const ids = dataset.requests.map((r) => r.id).sort();
    expect(ids).toEqual(["req-active", "req-hist", "req-terminal"]);
    expect(scan.counts.requestsResolvedByReference).toBe(2);
    // It used the status-filtered query, not a full paginate, for requests.
    expect(
      reader.calls.queryByStatusIn.some((c) => c.name === "waterRequests"),
    ).toBe(true);
    expect(reader.calls.paginate.some((c) => c.name === "waterRequests")).toBe(
      false,
    );
  });

  it("full-scan mode paginates all requests and reports complete", async () => {
    const reader = fakeReader(data);
    const { dataset, scan } = await assembleDataset(reader, { fullScan: true });
    expect(scan.mode).toBe("full-scan");
    expect(scan.scanStatus).toBe("complete");
    expect(dataset.requests).toHaveLength(3);
    // No resolution needed when everything is already loaded.
    expect(scan.counts.requestsResolvedByReference).toBe(0);
    expect(reader.calls.paginate.some((c) => c.name === "waterRequests")).toBe(
      true,
    );
  });

  it("reports truncation when a capped read is cut short", async () => {
    const reader = fakeReader(data, { truncated: { waterRequests: true } });
    const { scan } = await assembleDataset(reader, { fullScan: true });
    expect(scan.truncated).toBe(true);
    expect(scan.scanStatus).toBe("truncated");
    expect(scan.truncatedCollections).toContain("waterRequests");
  });
});

// --- maxRecords is a TOTAL budget: initial scan + referenced backfill --------

describe("assembleDataset — --max-records bounds initial scan AND backfill", () => {
  // 4 active requests are scanned; 3 terminal requests are only referenced (by
  // a batch's originalRequestIds), so they must be resolved via backfill.
  const budgetData = {
    driverRegistry: [],
    users: [],
    dispatchBatches: [
      {
        id: "b1",
        driverId: "d1",
        originalRequestIds: ["a1", "a2", "a3", "a4", "t1", "t2", "t3"],
        status: "active",
      },
    ],
    waterRequests: [
      { id: "a1", status: "claimed", assignedDriverId: "d1" },
      { id: "a2", status: "claimed", assignedDriverId: "d1" },
      { id: "a3", status: "claimed", assignedDriverId: "d1" },
      { id: "a4", status: "claimed", assignedDriverId: "d1" },
      { id: "t1", status: "confirmed", assignedDriverId: "d1" },
      { id: "t2", status: "confirmed", assignedDriverId: "d1" },
      { id: "t3", status: "confirmed", assignedDriverId: "d1" },
    ],
  };

  it("spends most of the budget on the scanned page and only the remainder on backfill", async () => {
    const reader = fakeReader(budgetData);
    // 4 active scanned + budget 5 => only 1 referenced request may be resolved.
    const { scan } = await assembleDataset(reader, { maxRecords: 5 });

    expect(scan.counts.requestsScanned).toBe(4);
    expect(scan.counts.requestsResolvedByReference).toBe(1);
    // Backfill honored the remaining budget (1), not all 3 referenced ids.
    const backfillCall = reader.calls.getByIds.find(
      (c) => c.name === "waterRequests",
    );
    expect(backfillCall?.ids).toHaveLength(1);
  });

  it("marks the scan truncated when referenced ids exceed the remaining budget", async () => {
    const reader = fakeReader(budgetData);
    const { dataset, scan } = await assembleDataset(reader, { maxRecords: 5 });

    expect(scan.truncated).toBe(true);
    expect(scan.scanStatus).toBe("truncated");
    expect(scan.truncatedCollections).toContain("waterRequests");
    expect(scan.counts.requestsUnresolvedByBudget).toBe(2);
    // The two unread referenced ids are recorded for the checks to skip.
    expect([...dataset.unresolvedRequestIds].sort()).toEqual(["t2", "t3"]);
  });

  it("never reads more waterRequests than the advertised budget", async () => {
    const reader = fakeReader(budgetData);
    const { dataset } = await assembleDataset(reader, { maxRecords: 5 });
    // Total request docs in the dataset = scanned page + backfill <= budget.
    expect(dataset.requests.length).toBeLessThanOrEqual(5);
    expect(dataset.requests).toHaveLength(5); // 4 scanned + 1 resolved
  });

  it("resolves all referenced ids when the budget is ample (no truncation)", async () => {
    const reader = fakeReader(budgetData);
    const { dataset, scan } = await assembleDataset(reader, {
      maxRecords: 100,
    });
    expect(scan.truncated).toBe(false);
    expect(scan.counts.requestsUnresolvedByBudget).toBe(0);
    expect(dataset.unresolvedRequestIds).toEqual([]);
    expect(dataset.requests).toHaveLength(7);
  });

  it("a budget-truncated but otherwise-clean run exits 3 (not 0, not a false missing finding)", async () => {
    // Clean data: one active member + two terminal members of a well-formed
    // batch; a tight budget leaves one terminal member unread.
    const cleanTruncatable = {
      driverRegistry: [
        { id: "reg1", linkedUserId: "d1", activeRequestId: null },
      ],
      users: [{ id: "d1", roles: ["resident", "driver"] }],
      dispatchBatches: [
        {
          id: "b1",
          driverId: "d1",
          originalRequestIds: ["a1", "t1", "t2"],
          status: "active",
        },
      ],
      waterRequests: [
        {
          id: "a1",
          status: "claimed",
          assignedDriverId: "d1",
          dispatchBatchId: "b1",
          customerId: null,
          preferredDriverId: null,
        },
        {
          id: "t1",
          status: "confirmed",
          assignedDriverId: "d1",
          dispatchBatchId: "b1",
          customerId: null,
          preferredDriverId: null,
        },
        {
          id: "t2",
          status: "confirmed",
          assignedDriverId: "d1",
          dispatchBatchId: "b1",
          customerId: null,
          preferredDriverId: null,
        },
      ],
    };
    const reader = fakeReader(cleanTruncatable);
    // 1 active scanned + budget 2 => resolve only t1; t2 stays unresolved.
    const result = await runDiagnosticScan(reader, runIntegrityChecks, {
      maxRecords: 2,
    });
    if (!result.ok) throw new Error("expected the scan to succeed");
    // No false "original_request_missing" for the unread t2, no false driver
    // findings, no false status drift — the run is clean but truncated.
    expect(result.findings).toEqual([]);
    expect(result.scan.truncated).toBe(true);
    expect(result.exitCode).toBe(3);
  });
});

// --- Scan/read/target failures map to exit 2 (item 1) -----------------------

describe("runDiagnosticScan failure semantics", () => {
  it("maps a reader/scan exception to a config/target/auth failure (exit 2)", async () => {
    const throwingReader = {
      async paginate() {
        throw new Error(
          "7 PERMISSION_DENIED: Missing or insufficient permissions.",
        );
      },
      async queryByStatusIn() {
        throw new Error("unreachable");
      },
      async getByIds() {
        return [];
      },
    };
    const result = await runDiagnosticScan(throwingReader, runIntegrityChecks, {
      fullScan: true,
    });
    expect(result.exitCode).toBe(2); // NOT 1 (findings) and NOT an uncontrolled exit
    if (result.ok) throw new Error("expected the scan to fail");
    expect(result.failure.phase).toBe("scan");
    expect(result.failure.message).toContain("PERMISSION_DENIED");
    // No dataset/findings are produced from a failed scan.
    expect("findings" in result).toBe(false);
  });

  it("returns a normal clean result (exit 0) when the scan succeeds", async () => {
    const reader = fakeReader({
      driverRegistry: [],
      users: [],
      dispatchBatches: [],
      waterRequests: [],
    });
    const result = await runDiagnosticScan(reader, runIntegrityChecks, {
      fullScan: true,
    });
    if (!result.ok) throw new Error("expected the scan to succeed");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

// --- Read-only proof against a fake Firestore db ----------------------------

function throwOnWrite(label: string) {
  return () => {
    throw new Error(`WRITE_NOT_ALLOWED: ${label}`);
  };
}

type Filter = { field: string; op: string; value: unknown };

function makeFakeDb(collections: FakeData) {
  function makeQuery(
    name: string,
    {
      filters = [],
      limit = Infinity,
      afterId = null,
    }: { filters?: Filter[]; limit?: number; afterId?: string | null },
  ) {
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(name, {
          filters: [...filters, { field, op, value }],
          limit,
          afterId,
        }),
      limit: (n: number) => makeQuery(name, { filters, limit: n, afterId }),
      startAfter: (docSnap: { id: string }) =>
        makeQuery(name, { filters, limit, afterId: docSnap.id }),
      async get() {
        let docs = (collections[name] ?? [])
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const f of filters) {
          if (f.op === "in")
            docs = docs.filter((d) =>
              (f.value as unknown[]).includes(d[f.field]),
            );
          else if (f.op === "==")
            docs = docs.filter((d) => d[f.field] === f.value);
        }
        if (afterId) docs = docs.filter((d) => d.id > afterId);
        const limited = docs.slice(0, limit === Infinity ? docs.length : limit);
        return {
          empty: limited.length === 0,
          size: limited.length,
          docs: limited.map((d) => ({ id: d.id, data: () => ({ ...d }) })),
        };
      },
      // Any write on a query/collection ref must never be called.
      set: throwOnWrite("query.set"),
      add: throwOnWrite("query.add"),
    };
  }
  return {
    collection: (name: string) => ({
      ...makeQuery(name, {}),
      doc: (id: string) => ({
        id,
        set: throwOnWrite("doc.set"),
        update: throwOnWrite("doc.update"),
        delete: throwOnWrite("doc.delete"),
        create: throwOnWrite("doc.create"),
      }),
    }),
    async getAll(...refs: Array<{ id: string; _collection?: string }>) {
      return refs.map((ref) => {
        const doc = (collections[ref._collection ?? ""] ?? []).find(
          (d) => d.id === ref.id,
        );
        // The reader builds refs via collection(name).doc(id); tag the collection.
        return {
          id: ref.id,
          exists: Boolean(doc),
          data: () => (doc ? { ...doc } : {}),
        };
      });
    },
    batch: throwOnWrite("db.batch"),
    runTransaction: throwOnWrite("db.runTransaction"),
  };
}

describe("makeFirestoreReader is read-only", () => {
  it("assembles a dataset against a db whose writes all throw", async () => {
    // Tag doc refs with their collection so the fake getAll can resolve them.
    const collections = {
      driverRegistry: [
        {
          id: "reg-1",
          linkedUserId: "d1",
          activeRequestId: "req-1",
          archivedAt: null,
        },
      ],
      users: [{ id: "d1", roles: ["resident", "driver"] }],
      dispatchBatches: [
        {
          id: "b1",
          originalRequestIds: ["req-1"],
          status: "active",
          driverId: "d1",
        },
      ],
      waterRequests: [
        {
          id: "req-1",
          status: "claimed",
          assignedDriverId: "d1",
          customerId: null,
          dispatchBatchId: null,
          preferredDriverId: null,
        },
      ],
    };
    const db = makeFakeDb(collections);
    // Patch collection().doc() to tag the collection for getAll resolution.
    const originalCollection = db.collection.bind(db);
    db.collection = (name: string) => {
      const col = originalCollection(name);
      const originalDoc = col.doc.bind(col);
      col.doc = (id: string) => ({ ...originalDoc(id), _collection: name });
      return col;
    };

    const reader = makeFirestoreReader(db);
    const { dataset, scan } = await assembleDataset(reader, { fullScan: true });

    expect(scan.scanStatus).toBe("complete");
    expect(dataset.drivers).toHaveLength(1);
    expect(dataset.requests).toHaveLength(1);

    // Also exercise the getByIds / getAll read path directly.
    const byId = await reader.getByIds("waterRequests", ["req-1"], ["status"]);
    expect(byId).toHaveLength(1);
    expect(byId[0].id).toBe("req-1");
    // If any write path had been hit, the throwing stubs would have failed the run.
  });
});

describe("computeExitCode", () => {
  const clean = { bySeverity: { critical: 0, warning: 0, info: 0 } };
  it("returns 0 for a complete clean scan", () => {
    expect(computeExitCode(clean, { truncated: false })).toBe(0);
  });
  it("returns 1 when critical or warning findings exist", () => {
    expect(
      computeExitCode(
        { bySeverity: { critical: 1, warning: 0, info: 0 } },
        { truncated: false },
      ),
    ).toBe(1);
    expect(
      computeExitCode(
        { bySeverity: { critical: 0, warning: 2, info: 0 } },
        { truncated: true },
      ),
    ).toBe(1);
  });
  it("returns 3 for a truncated scan with no meaningful findings (not a false clean pass)", () => {
    expect(computeExitCode(clean, { truncated: true })).toBe(3);
  });
  it("does not fail (exit 0) for info-only findings on a complete scan", () => {
    expect(
      computeExitCode(
        { bySeverity: { critical: 0, warning: 0, info: 5 } },
        { truncated: false },
      ),
    ).toBe(0);
  });
});
