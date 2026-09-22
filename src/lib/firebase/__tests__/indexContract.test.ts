import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DOC_ID_FIELD,
  QUERY_SHAPES,
  RETAINED_INDEXES,
  collectionPathMatches,
  expectedIndexFields,
  indexSignature,
  shapeRequiresCompositeIndex,
  type IndexFieldSpec,
  type QueryFilterOp,
} from "../indexContract";

// ---------------------------------------------------------------------------
// Recording Firestore fake
//
// Implements just enough of the Admin SDK surface to let the real domain
// functions run against it while capturing every query shape they issue.
// Empty result sets keep control flow on the simplest path — the point is to
// record which queries the code CONSTRUCTS, not to simulate data.
// ---------------------------------------------------------------------------

interface RecordedQuery {
  collectionPath: string;
  filters: { fieldPath: string; op: QueryFilterOp }[];
  orderBy: { fieldPath: string; direction: "asc" | "desc" }[];
}

const ctx = {
  recorded: [] as RecordedQuery[],
  /** Cumulative record across the whole suite — never cleared. */
  allRecorded: [] as RecordedQuery[],
  docs: new Map<string, Record<string, unknown>>(),
};

function fieldNameOf(field: unknown): string {
  // FieldPath.documentId() arrives as a sentinel object, not a string.
  return typeof field === "string" ? field : DOC_ID_FIELD;
}

let autoCounter = 0;
function autoId(): string {
  return `auto-${++autoCounter}`;
}

function docSnap(path: string) {
  return {
    id: path.split("/").pop() ?? path,
    exists: ctx.docs.has(path),
    ref: makeRef(path),
    data: () => ctx.docs.get(path),
  };
}

function emptyQuerySnapshot() {
  const docs: unknown[] = [];
  return {
    docs,
    empty: true,
    size: 0,
    forEach: (fn: (d: unknown) => void) => docs.forEach(fn),
  };
}

function record(
  path: string,
  filters: RecordedQuery["filters"],
  orderBy: RecordedQuery["orderBy"],
) {
  const entry = {
    collectionPath: path,
    filters: [...filters],
    orderBy: [...orderBy],
  };
  ctx.recorded.push(entry);
  ctx.allRecorded.push(entry);
}

interface FakeDocSnap {
  id: string;
  exists: boolean;
  ref: FakeRefApi;
  data: () => Record<string, unknown> | undefined;
}

interface FakeQuerySnap {
  docs: unknown[];
  empty: boolean;
  size: number;
  forEach: (fn: (d: unknown) => void) => void;
}

interface FakeQueryApi {
  where: (fieldPath: string, op: QueryFilterOp, value: unknown) => FakeQueryApi;
  orderBy: (field: unknown, direction?: string) => FakeQueryApi;
  limit: (n: number) => FakeQueryApi;
  limitToLast: (n: number) => FakeQueryApi;
  startAt: (...args: unknown[]) => FakeQueryApi;
  startAfter: (...args: unknown[]) => FakeQueryApi;
  endAt: (...args: unknown[]) => FakeQueryApi;
  endBefore: (...args: unknown[]) => FakeQueryApi;
  offset: (n: number) => FakeQueryApi;
  get: () => Promise<FakeQuerySnap>;
  count: () => { get: () => Promise<{ data: () => { count: number } }> };
  doc: (id?: string) => FakeRefApi;
  add: (data: Record<string, unknown>) => Promise<FakeRefApi>;
}

interface FakeRefApi {
  _path: string;
  id: string;
  get: () => Promise<FakeDocSnap>;
  collection: (sub: string) => FakeQueryApi;
  set: (data: Record<string, unknown>) => Promise<void>;
  update: (data: Record<string, unknown>) => Promise<void>;
  create: (data: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
}

function makeQuery(
  path: string,
  filters: RecordedQuery["filters"],
  orderBy: RecordedQuery["orderBy"],
): FakeQueryApi {
  const api: FakeQueryApi = {
    where: (fieldPath: string, op: QueryFilterOp, _value: unknown) =>
      makeQuery(path, [...filters, { fieldPath, op }], orderBy),
    orderBy: (field: unknown, direction?: string) =>
      makeQuery(path, filters, [
        ...orderBy,
        {
          fieldPath: fieldNameOf(field),
          direction: direction === "desc" ? "desc" : "asc",
        },
      ]),
    limit: (_n: number) => api,
    limitToLast: (_n: number) => api,
    startAt: () => api,
    startAfter: () => api,
    endAt: () => api,
    endBefore: () => api,
    offset: () => api,
    get: async () => {
      record(path, filters, orderBy);
      return emptyQuerySnapshot();
    },
    count: () => ({
      get: async () => {
        record(path, filters, orderBy);
        return { data: () => ({ count: 0 }) };
      },
    }),
    doc: (id?: string) => makeRef(`${path}/${id ?? autoId()}`),
    add: async (data: Record<string, unknown>) => {
      const ref = makeRef(`${path}/${autoId()}`);
      ctx.docs.set(ref._path, data);
      return ref;
    },
  };
  return api;
}

function makeCollection(path: string): FakeQueryApi {
  return makeQuery(path, [], []);
}

function makeRef(path: string): FakeRefApi {
  return {
    _path: path,
    id: path.split("/").pop() ?? path,
    get: async () => docSnap(path),
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
    set: async (data: Record<string, unknown>) => {
      ctx.docs.set(path, data);
    },
    update: async (data: Record<string, unknown>) => {
      ctx.docs.set(path, { ...(ctx.docs.get(path) ?? {}), ...data });
    },
    create: async (data: Record<string, unknown>) => {
      if (ctx.docs.has(path)) throw new Error("ALREADY_EXISTS");
      ctx.docs.set(path, data);
    },
    delete: async () => {
      ctx.docs.delete(path);
    },
  };
}

const fakeTxn = {
  get: async (target: { get: () => Promise<unknown> }) => target.get(),
  getAll: async (...refs: FakeRefApi[]) => refs.map((r) => docSnap(r._path)),
  set: (ref: FakeRefApi, data: Record<string, unknown>) => {
    ctx.docs.set(ref._path, data);
  },
  update: (ref: FakeRefApi, data: Record<string, unknown>) => {
    ctx.docs.set(ref._path, { ...(ctx.docs.get(ref._path) ?? {}), ...data });
  },
  create: (ref: FakeRefApi, data: Record<string, unknown>) => {
    ctx.docs.set(ref._path, data);
  },
  delete: (ref: FakeRefApi) => {
    ctx.docs.delete(ref._path);
  },
};

const fakeDb = {
  collection: (name: string) => makeCollection(name),
  collectionGroup: (name: string) => makeCollection(name),
  runTransaction: async <T>(
    fn: (txn: typeof fakeTxn) => Promise<T> | T,
  ): Promise<T> => fn(fakeTxn),
  getAll: async (...refs: FakeRefApi[]) => refs.map((r) => docSnap(r._path)),
  batch: () => ({
    set: () => fakeTxn,
    update: () => fakeTxn,
    create: () => fakeTxn,
    delete: () => fakeTxn,
    commit: async () => undefined,
  }),
};

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => fakeDb,
  getAdminAuth: () => ({}),
  isFirebaseAdminConfigured: true,
}));

// ---------------------------------------------------------------------------
// Domain modules under test (imported after the mocks above)
// ---------------------------------------------------------------------------

import {
  countDeclinesToday,
  createDriverOffer,
  getDeclinedRequestIdsForDriver,
  getOfferAggregate,
  getPendingOfferForDriver,
} from "@/lib/domain/driverOffers";
import {
  declineDriverOffer,
  getNextOfferForDriver,
} from "@/lib/domain/dispatch";
import {
  createWaterRequest,
  expirePreferredDriverHolds,
  findActiveRequestsByPhone,
  getActiveCustomerIds,
  getActiveRequestForCustomer,
  getAllRequests,
  getBatchEligibleRequests,
  getClaimedRequestsForDriver,
  getMostRecentConfirmedRequest,
  getOutstandingRequestsForContinuityReport,
  getRequestEvents,
  getRequestsForCustomer,
  getRequestsForDispatchBatch,
} from "@/lib/domain/waterRequests";
import { getStatistics } from "@/lib/domain/statistics";
import {
  getAllDispatchBatches,
  getDispatchBatchEvents,
} from "@/lib/domain/dispatchBatches";
import {
  getAllDriverRegistryEntries,
  getDeleteDriverEligibility,
  getDriverByLinkedUserId,
  getDriverEvents,
  getMeterAssignments,
} from "@/lib/domain/driverRegistry";
import { processNotificationOutbox } from "@/lib/notifications/worker";
import {
  getOutboxStateCounts,
  listNotificationsByState,
} from "@/lib/notifications/outboxAdmin";
import {
  getMergeReconciliationOverview,
  listUnresolvedMergeReconciliations,
  processMergeAuthReconciliation,
} from "@/lib/domain/mergeReconciliation";
import { countAdmins, getAllUsers, getRoleEvents } from "@/lib/domain/admin";
import { findUsersByPhone, getResidentDirectory } from "@/lib/domain/users";
import { getFillStations } from "@/lib/domain/fillStations";
import {
  findPossibleRequestHistoryMatchesForUser,
  getRecentAccountMergeEvents,
} from "@/lib/domain/identity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordedSignature(q: RecordedQuery): string {
  const filters = q.filters
    .map((f) => `${f.fieldPath}${f.op}`)
    .sort()
    .join(",");
  const orderBy = q.orderBy
    .map((o) => `${o.fieldPath}:${o.direction}`)
    .join(",");
  return `${q.collectionPath} [${filters}] => [${orderBy}]`;
}

function recordedSignatures(): Set<string> {
  return new Set(ctx.recorded.map(recordedSignature));
}

function registrySignature(spec: (typeof QUERY_SHAPES)[number]): string {
  const filters = spec.filters
    .map((f) => `${f.fieldPath}${f.op}`)
    .sort()
    .join(",");
  const orderBy = spec.orderBy
    .map((o) => `${o.fieldPath}:${o.direction}`)
    .join(",");
  return `${spec.collectionPath} [${filters}] => [${orderBy}]`;
}

/** Match a recorded path against a registry `{placeholder}` pattern. */
function signatureMatches(registrySig: string, recordedSig: string): boolean {
  const [regPath, regRest] = registrySig.split(" ", 2);
  const [recPath, recRest] = recordedSig.split(" ", 2);
  return regRest === recRest && collectionPathMatches(regPath, recPath);
}

interface ManifestIndex {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string; order: string }[];
}

function loadManifest(): ManifestIndex[] {
  const raw = readFileSync(
    path.join(__dirname, "../../../../firestore.indexes.json"),
    "utf8",
  );
  return (JSON.parse(raw) as { indexes: ManifestIndex[] }).indexes;
}

/**
 * Firestore appends an implicit document-ID ordering to every deployed
 * composite index (last field's direction). Manifest entries may omit it;
 * normalize so manifest and registry signatures compare like-for-like.
 */
function manifestSignature(entry: ManifestIndex): string {
  const fields: IndexFieldSpec[] = entry.fields.map((f) => ({
    fieldPath: f.fieldPath,
    order: f.order as IndexFieldSpec["order"],
  }));
  if (fields[fields.length - 1]?.fieldPath !== DOC_ID_FIELD) {
    const lastOrder = fields[fields.length - 1]?.order ?? "ASCENDING";
    fields.push({ fieldPath: DOC_ID_FIELD, order: lastOrder });
  }
  return indexSignature(entry.collectionGroup, fields);
}

// ---------------------------------------------------------------------------
// Manifest ↔ contract
// ---------------------------------------------------------------------------

describe("firestore.indexes.json structure", () => {
  const manifest = loadManifest();

  it("is well-formed: COLLECTION scope, valid field orders, __name__ only last", () => {
    for (const entry of manifest) {
      expect(entry.collectionGroup, "collectionGroup").toBeTruthy();
      expect(entry.queryScope).toBe("COLLECTION");
      expect(entry.fields.length).toBeGreaterThanOrEqual(2);
      for (const field of entry.fields) {
        expect(["ASCENDING", "DESCENDING"]).toContain(field.order);
        expect(field.fieldPath).toBeTruthy();
      }
      const docIdPositions = entry.fields
        .map((f, i) => (f.fieldPath === DOC_ID_FIELD ? i : -1))
        .filter((i) => i >= 0);
      for (const i of docIdPositions) {
        expect(i).toBe(entry.fields.length - 1);
      }
    }
  });

  it("contains no duplicate index definitions", () => {
    const seen = new Set<string>();
    for (const entry of manifest) {
      const sig = indexSignature(
        entry.collectionGroup,
        entry.fields as IndexFieldSpec[],
      );
      expect(seen.has(sig), `duplicate index ${sig}`).toBe(false);
      seen.add(sig);
    }
  });
});

describe("manifest covers the query contract", () => {
  const manifestSigs = new Set(loadManifest().map(manifestSignature));

  it("every required composite index exists in firestore.indexes.json", () => {
    for (const shape of QUERY_SHAPES) {
      if (!shape.requiredIndex) continue;
      const sig = indexSignature(
        shape.collectionPath.split("/").pop()!,
        shape.requiredIndex,
      );
      expect(
        manifestSigs.has(sig),
        `${shape.id} requires ${sig} — missing from firestore.indexes.json`,
      ).toBe(true);
    }
  });

  it("every manifest entry is required by a registered shape or explicitly retained", () => {
    const requiredSigs = new Set(
      QUERY_SHAPES.filter((s) => s.requiredIndex).map((s) =>
        indexSignature(s.collectionPath.split("/").pop()!, s.requiredIndex!),
      ),
    );
    const retainedSigs = new Set(
      RETAINED_INDEXES.map((r) => indexSignature(r.collectionGroup, r.fields)),
    );
    for (const entry of loadManifest()) {
      const sig = manifestSignature(entry);
      expect(
        requiredSigs.has(sig) || retainedSigs.has(sig),
        `unexplained manifest index: ${sig} — add a QUERY_SHAPES entry that requires it, a RETAINED_INDEXES entry with a reason, or remove it`,
      ).toBe(true);
    }
  });

  it("every retained index still exists in the manifest", () => {
    for (const retained of RETAINED_INDEXES) {
      const sig = indexSignature(retained.collectionGroup, retained.fields);
      expect(
        manifestSigs.has(sig),
        `RETAINED_INDEXES entry is no longer deployed: ${sig} — remove the stale allowlist entry`,
      ).toBe(true);
    }
  });
});

describe("registry index requirements match Firestore semantics", () => {
  it("requiredIndex is non-null exactly when the shape needs a composite", () => {
    for (const shape of QUERY_SHAPES) {
      expect(
        shapeRequiresCompositeIndex(shape),
        `${shape.id}: requiredIndex ${shape.requiredIndex ? "declared" : "omitted"} but shape ${shapeRequiresCompositeIndex(shape) ? "requires" : "does not require"} a composite`,
      ).toBe(shape.requiredIndex !== null);
    }
  });

  it("declared indexes equal the canonical index for their shape", () => {
    for (const shape of QUERY_SHAPES) {
      if (!shape.requiredIndex) continue;
      const expected = expectedIndexFields(shape)!;
      const declared = shape.requiredIndex;
      expect(declared.length, `${shape.id}: field count`).toBe(expected.length);
      // Same multiset of fields — equality-field order is unconstrained.
      const sig = (f: IndexFieldSpec[]) =>
        f.map((x) => `${x.fieldPath}:${x.order}`).sort();
      expect(sig(declared), `${shape.id}: field set`).toEqual(sig(expected));
      // Ordered fields must appear in the query's effective order — the
      // suffix of the index after the equality prefix and before __name__.
      const eqCount = new Set(
        shape.filters
          .filter((f) =>
            ["==", "in", "array-contains", "array-contains-any"].includes(f.op),
          )
          .map((f) => f.fieldPath),
      ).size;
      expect(declared.slice(eqCount)).toEqual(expected.slice(eqCount));
    }
  });

  it("no declared index is a composite over only document ID (issue #96 rule)", () => {
    for (const shape of QUERY_SHAPES) {
      if (!shape.requiredIndex) continue;
      const nonDocId = shape.requiredIndex.filter(
        (f) => f.fieldPath !== DOC_ID_FIELD,
      );
      expect(
        nonDocId.length,
        `${shape.id}: composite index must include a data field`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Shape assertions: drive the real code paths and compare recorded queries
// ---------------------------------------------------------------------------

describe("recorded query shapes match the contract", () => {
  beforeEach(() => {
    ctx.recorded = [];
    ctx.docs.clear();
  });

  it("driver offer readers issue the registered shapes", async () => {
    await getPendingOfferForDriver("driver-1");
    await getDeclinedRequestIdsForDriver("driver-1");
    await countDeclinesToday("driver-1");
    await getOfferAggregate(null);
    await getOfferAggregate(new Date("2026-01-01T00:00:00Z"));

    const produced = recordedSignatures();
    const expected = QUERY_SHAPES.filter((s) =>
      [
        "driverOffers/pending-for-driver",
        "driverOffers/declined-history",
        "driverOffers/recent-declines-unordered",
        "driverOffers/offer-window-scan",
        "driverOffers/full-scan",
      ].includes(s.id),
    ).map(registrySignature);
    for (const sig of expected) {
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `expected shape not produced: ${sig}`,
      ).toBe(true);
    }
  });

  it("declineDriverOffer transaction issues the incident shape", async () => {
    ctx.docs.set("driverOffers/offer-1", {
      driverId: "driver-1",
      requestId: "req-1",
      response: null,
    });
    ctx.docs.set("waterRequests/req-1", { status: "available" });

    await declineDriverOffer({ offerId: "offer-1", driverId: "driver-1" });

    const produced = recordedSignatures();
    const incident = QUERY_SHAPES.find(
      (s) => s.id === "driverOffers/recent-declines-unordered",
    )!;
    const duplicateGuard = QUERY_SHAPES.find(
      (s) => s.id === "driverOffers/pending-for-request",
    )!;
    for (const spec of [incident, duplicateGuard]) {
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `decline transaction did not issue ${spec.id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("createDriverOffer issues the duplicate-offer guard query", async () => {
    await createDriverOffer("driver-1", "req-1");
    const produced = recordedSignatures();
    const spec = QUERY_SHAPES.find(
      (s) => s.id === "driverOffers/pending-for-request",
    )!;
    expect(
      [...produced].some((p) => signatureMatches(registrySignature(spec), p)),
    ).toBe(true);
  });

  it("getNextOfferForDriver issues every dispatch selection shape", async () => {
    await getNextOfferForDriver("user-1");

    const produced = recordedSignatures();
    const expectedIds = [
      "driverRegistry/by-linked-user",
      "waterRequests/claimed-for-driver",
      "driverOffers/declined-history",
      "driverOffers/pending-for-driver",
      "waterRequests/hold-expiry",
      "waterRequests/dispatch-ranked-hold",
      "waterRequests/dispatch-byage-hold",
      "waterRequests/dispatch-catchall-hold",
      "waterRequests/dispatch-ranked-available",
      "waterRequests/dispatch-byage-available",
      "waterRequests/dispatch-catchall-available",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `dispatch selection did not issue ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("water request readers issue the registered shapes", async () => {
    await getActiveRequestForCustomer("cust-1");
    await getRequestsForCustomer("cust-1");
    await getMostRecentConfirmedRequest("cust-1");
    await getActiveCustomerIds();
    await findActiveRequestsByPhone("+17205550100");
    await getClaimedRequestsForDriver("driver-1");
    await getBatchEligibleRequests();
    await getRequestsForDispatchBatch("batch-1");
    await expirePreferredDriverHolds();
    await getAllRequests();
    await getOutstandingRequestsForContinuityReport();
    await getRequestEvents("req-1");

    const produced = recordedSignatures();
    const expectedIds = [
      "waterRequests/active-for-customer",
      "waterRequests/history-for-customer",
      "waterRequests/latest-confirmed-for-customer",
      "waterRequests/active-statuses",
      "waterRequests/active-by-phone",
      "waterRequests/claimed-for-driver",
      "waterRequests/batch-eligible",
      "waterRequests/batch-members",
      "waterRequests/hold-expiry",
      "waterRequests/all-recent-first",
      "waterRequests/outstanding-continuity",
      "waterRequests/events-chronological",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `expected shape not produced: ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("createWaterRequest issues its duplicate/active-check queries", async () => {
    await createWaterRequest({
      customerId: "cust-1",
      loads: 1,
      village: "The Bottom",
      deliveryDirections: "Up the hill",
      waterSituation: { reportedUrgency: "normal" },
      attestationAccepted: true,
      customer: {
        displayName: "Test Customer",
        phone: "+17205550100",
        email: null,
      },
    });

    const produced = recordedSignatures();
    const expectedIds = [
      "waterRequests/delivered-for-customer",
      "waterRequests/active-for-customer-unordered",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `createWaterRequest did not issue ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("statistics queries issue the registered shapes", async () => {
    await getStatistics("all");
    ctx.recorded = [];
    await getStatistics("7d");

    const produced = recordedSignatures();
    const expectedIds = [
      "waterRequests/stats-window",
      "driverOffers/offer-window-scan",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `getStatistics(7d) did not issue ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("dispatch batch, registry, identity and admin readers issue the registered shapes", async () => {
    ctx.docs.set("driverRegistry/driver-1", {
      displayName: "Driver One",
      linkedUserId: "user-1",
    });
    ctx.docs.set("users/user-1", {
      email: "driver@example.com",
      phone: "+17205550100",
      roles: ["resident"],
    });

    await getAllDispatchBatches();
    await getDispatchBatchEvents("batch-1");
    await getDeleteDriverEligibility("driver-1");
    await getDriverByLinkedUserId("user-1");
    await getAllDriverRegistryEntries();
    await getMeterAssignments("driver-1");
    await getDriverEvents("driver-1");
    await getResidentDirectory();
    await findUsersByPhone("+17205550100");
    await getAllUsers();
    await countAdmins();
    await getRoleEvents("user-1");
    await getRecentAccountMergeEvents();
    await findPossibleRequestHistoryMatchesForUser("user-1");
    await getFillStations();

    const produced = recordedSignatures();
    const expectedIds = [
      "dispatchBatches/recent-first",
      "dispatchBatches/events-chronological",
      "dispatchBatches/by-driver",
      "driverOffers/by-driver",
      "waterRequests/by-assigned-driver",
      "waterRequests/by-preferred-driver",
      "driverRegistry/by-linked-user",
      "driverRegistry/all",
      "driverRegistry/events-recent",
      "driverRegistry/meters-all",
      "users/all",
      "users/by-phone",
      "users/admins",
      "users/role-events-recent",
      "accountMergeEvents/recent-first",
      "waterRequests/unregistered-scan",
      "fillStations/by-name",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `expected shape not produced: ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("notification outbox and merge reconciliation issue the registered shapes", async () => {
    await processNotificationOutbox({ now: 0 });
    await listNotificationsByState("failed");
    await getOutboxStateCounts();
    await processMergeAuthReconciliation({ now: 0 });
    await listUnresolvedMergeReconciliations();
    await getMergeReconciliationOverview(0);

    const produced = recordedSignatures();
    const expectedIds = [
      "notificationOutbox/pending-due",
      "notificationOutbox/expired-leases",
      "notificationOutbox/by-state-newest",
      "notificationOutbox/state-count",
      "accountMergeEvents/due-pending",
      "accountMergeEvents/expired-leases",
      "accountMergeEvents/unresolved-oldest",
      "accountMergeEvents/active-lease-count",
      "accountMergeEvents/stale-lease-count",
      "accountMergeEvents/unresolved-count",
      "accountMergeEvents/state-count",
    ];
    for (const id of expectedIds) {
      const spec = QUERY_SHAPES.find((s) => s.id === id)!;
      const sig = registrySignature(spec);
      expect(
        [...produced].some((p) => signatureMatches(sig, p)),
        `expected shape not produced: ${id}: ${sig}`,
      ).toBe(true);
    }
  });

  it("every recorded shape is registered in the contract", () => {
    // Guard against a NEW query silently appearing: any shape recorded but
    // absent from QUERY_SHAPES fails. Runs after the drives above and
    // asserts over everything the suite accumulated.
    const registrySigs = QUERY_SHAPES.map(registrySignature);
    for (const rec of ctx.allRecorded) {
      const sig = recordedSignature(rec);
      expect(
        registrySigs.some((r) => signatureMatches(r, sig)),
        `unregistered query shape recorded: ${sig} — add a QUERY_SHAPES entry (and an index if required)`,
      ).toBe(true);
    }
  });

  it("every shape-asserted registry entry was actually produced", () => {
    // Runs last: asserts each "shape-asserted" entry was exercised by at
    // least one drive above, so verification claims stay honest.
    const produced = new Set(ctx.allRecorded.map(recordedSignature));
    const missing = QUERY_SHAPES.filter(
      (s) =>
        s.verification === "shape-asserted" &&
        !produced.has(registrySignature(s)) &&
        ![...produced].some((p) => signatureMatches(registrySignature(s), p)),
    );
    expect(
      missing.map((s) => s.id),
      "shape-asserted entries not exercised by any test",
    ).toEqual([]);
  });
});
