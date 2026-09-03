import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock server-only before any domain imports
vi.mock("server-only", () => ({}));

import type { DeleteDriverEligibility } from "@/lib/domain/driverRegistry";

// ---------------------------------------------------------------------------
// Mock shape helpers
// ---------------------------------------------------------------------------

/** Minimal Firestore Timestamp stub */
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

function makeDriverDoc(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    exists: true,
    data: () => ({
      displayName: "Test Driver",
      phone: null,
      linkedUserId: null,
      eligibilityStatus: "ineligible",
      availabilityStatus: "offline",
      ineligibilityReason: "Pending government approval",
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      archivedPreviousEligibilityStatus: null,
      archivedPreviousIneligibilityReason: null,
      createdAt: ts("2026-01-01"),
      createdBy: "admin-1",
      updatedAt: ts("2026-01-01"),
      updatedBy: "admin-1",
      ...overrides,
    }),
  };
}

function makeActiveDriverDoc(id: string, overrides: Record<string, unknown> = {}) {
  return makeDriverDoc(id, {
    linkedUserId: "user-1",
    eligibilityStatus: "eligible",
    availabilityStatus: "online",
    ineligibilityReason: null,
    ...overrides,
  });
}

function makeArchivedDriverDoc(id: string, overrides: Record<string, unknown> = {}) {
  return makeDriverDoc(id, {
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: "Archived: retired",
    archivedAt: ts("2026-02-01"),
    archivedBy: "admin-1",
    archiveReason: "retired",
    archivedPreviousEligibilityStatus: "eligible",
    archivedPreviousIneligibilityReason: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Firestore transaction mock
// ---------------------------------------------------------------------------

let txnGetResults: Map<string, unknown>;
let txnWrites: { op: string; path: string; data?: unknown }[];

function makeTxn() {
  txnWrites = [];
  return {
    get: vi.fn((ref: { path: string; collection?: (n: string) => unknown }) => {
      // Support subcollection queries passed as query objects
      const result = txnGetResults.get(ref.path);
      if (result !== undefined) return Promise.resolve(result);
      // Default: empty snapshot for subcollection queries
      return Promise.resolve({ size: 0, docs: [], empty: true });
    }),
    update: vi.fn((ref: { path: string }, data: unknown) => {
      txnWrites.push({ op: "update", path: ref.path, data });
    }),
    create: vi.fn((ref: { path: string }, data: unknown) => {
      txnWrites.push({ op: "create", path: ref.path, data });
    }),
    delete: vi.fn((ref: { path: string }) => {
      txnWrites.push({ op: "delete", path: ref.path });
    }),
    set: vi.fn((ref: { path: string }, data: unknown) => {
      txnWrites.push({ op: "set", path: ref.path, data });
    }),
  };
}

// ---------------------------------------------------------------------------
// Firestore DB mock (comprehensive)
// ---------------------------------------------------------------------------

let collectionGetResults: Map<string, unknown>;
let docGetResults: Map<string, unknown>;
let queryResults: Map<string, unknown>;

function makeSubcollection(parentPath: string, subcol: string) {
  const subPath = `${parentPath}/${subcol}`;
  return {
    path: subPath,
    doc: (docId?: string) => {
      const dPath = `${subPath}/${docId ?? "auto-id"}`;
      return {
        path: dPath,
        get: vi.fn(() => Promise.resolve(docGetResults.get(dPath) ?? { exists: false, data: () => null })),
        collection: (sub2: string) => makeSubcollection(dPath, sub2),
      };
    },
    get: vi.fn(() => {
      const result = collectionGetResults.get(subPath);
      return Promise.resolve(result ?? { docs: [], size: 0, empty: true });
    }),
    where: vi.fn(function (this: unknown, field: string, _op: string, value: unknown) {
      const queryKey = `${subPath}?${field}=${value}`;
      const self = {
        path: subPath,
        where: vi.fn(() => self),
        orderBy: vi.fn(() => self),
        limit: vi.fn(() => self),
        get: vi.fn(() => {
          // Check for specific query results or fall back to collection
          const result = queryResults.get(queryKey);
          return Promise.resolve(result ?? { docs: [], size: 0, empty: true });
        }),
      };
      return self;
    }),
    orderBy: vi.fn(function () {
      const self = {
        path: subPath,
        limit: vi.fn(() => self),
        get: vi.fn(() => Promise.resolve({ docs: [], size: 0, empty: true })),
      };
      return self;
    }),
  };
}

function makeFakeDb() {
  collectionGetResults = new Map();
  docGetResults = new Map();
  queryResults = new Map();
  txnGetResults = new Map();

  return {
    collection: vi.fn((name: string) => {
      const colPath = name;
      return {
        path: colPath,
        doc: (docId?: string) => {
          const dPath = `${colPath}/${docId ?? "auto-id"}`;
          return {
            path: dPath,
            get: vi.fn(() => Promise.resolve(docGetResults.get(dPath) ?? { exists: false, data: () => null })),
            collection: (sub: string) => makeSubcollection(dPath, sub),
          };
        },
        get: vi.fn(() => {
          const result = collectionGetResults.get(colPath);
          return Promise.resolve(result ?? { docs: [], size: 0, empty: true });
        }),
        where: vi.fn((field: string, _op: string, value: unknown) => {
          const queryKey = `${colPath}?${field}=${value}`;
          const self = {
            path: colPath,
            where: vi.fn(() => self),
            orderBy: vi.fn(() => self),
            limit: vi.fn(() => self),
            get: vi.fn(() => {
              const result = queryResults.get(queryKey);
              return Promise.resolve(result ?? { docs: [], size: 0, empty: true });
            }),
          };
          return self;
        }),
      };
    }),
    runTransaction: vi.fn(async (fn: (txn: ReturnType<typeof makeTxn>) => Promise<void>) => {
      const txn = makeTxn();
      await fn(txn);
    }),
  };
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => fakeDb,
}));

// FieldValue.serverTimestamp mock
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: "serverTimestamp" }),
    delete: () => ({ _type: "delete" }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const {
  getActiveDriverRegistryEntries,
  getArchivedDriverRegistryEntries,
  getEligibleDriverOptions,
  archiveDriver,
  restoreArchivedDriver,
  getDeleteDriverEligibility,
  deleteDriver,
  isDriverImmediatelyAvailable,
} = await import("@/lib/domain/driverRegistry");

beforeEach(() => {
  fakeDb = makeFakeDb();
  collectionGetResults.clear();
  docGetResults.clear();
  queryResults.clear();
  txnGetResults.clear();
});

// ---------------------------------------------------------------------------
// View filtering tests
// ---------------------------------------------------------------------------

describe("driver registry lifecycle views", () => {
  const activeDoc = makeActiveDriverDoc("active-1");
  const archivedDoc = makeArchivedDriverDoc("archived-1");

  beforeEach(() => {
    collectionGetResults.set("driverRegistry", { docs: [activeDoc, archivedDoc] });
  });

  it("active view excludes archived drivers", async () => {
    const active = await getActiveDriverRegistryEntries();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("active-1");
    expect(active[0].archivedAt).toBeNull();
  });

  it("archived view includes only archived drivers", async () => {
    const archived = await getArchivedDriverRegistryEntries();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("archived-1");
    expect(archived[0].archivedAt).not.toBeNull();
  });

  it("eligible-driver options exclude archived and unlinked drivers", async () => {
    const options = await getEligibleDriverOptions();
    expect(options).toHaveLength(1);
    expect(options[0].uid).toBe("user-1");
  });

  it("isDriverImmediatelyAvailable returns false for archived drivers", async () => {
    // isDriverImmediatelyAvailable looks up by linked userId. Set up a
    // linked but archived driver so it's found via the "where" query.
    const archivedLinked = makeArchivedDriverDoc("archived-linked", {
      linkedUserId: "archived-user",
    });
    queryResults.set("driverRegistry?linkedUserId=archived-user", {
      docs: [archivedLinked],
      size: 1,
      empty: false,
    });
    const result = await isDriverImmediatelyAvailable("archived-user");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Archive tests
// ---------------------------------------------------------------------------

describe("archiveDriver", () => {
  it("archives an eligible driver with reason and preserves previous status", async () => {
    const driverId = "driver-to-archive";
    const doc = makeActiveDriverDoc(driverId, {
      eligibilityStatus: "eligible",
      availabilityStatus: "online",
    });

    // Pre-transaction read
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    // Transaction read
    txnGetResults.set(`driverRegistry/${driverId}`, doc);

    await archiveDriver({
      driverId,
      archivedBy: "admin-1",
      reason: "Driver retired",
    });

    // Verify transaction writes
    expect(txnWrites).toContainEqual(
      expect.objectContaining({
        op: "update",
        path: `driverRegistry/${driverId}`,
        data: expect.objectContaining({
          eligibilityStatus: "ineligible",
          availabilityStatus: "offline",
          archiveReason: "Driver retired",
          archivedPreviousEligibilityStatus: "eligible",
        }),
      }),
    );
    // Verify audit event was created
    expect(txnWrites).toContainEqual(
      expect.objectContaining({
        op: "create",
        data: expect.objectContaining({
          type: "driver_archived",
          actorId: "admin-1",
          metadata: expect.objectContaining({
            reason: "Driver retired",
            previousEligibilityStatus: "eligible",
          }),
        }),
      }),
    );
  });

  it("rejects archive without a reason", async () => {
    await expect(
      archiveDriver({
        driverId: "driver-1",
        archivedBy: "admin-1",
        reason: "",
      }),
    ).rejects.toThrow("ARCHIVE_REASON_REQUIRED");
  });

  it("rejects archive of non-existent driver", async () => {
    docGetResults.set("driverRegistry/nonexistent", { exists: false, data: () => null });

    await expect(
      archiveDriver({
        driverId: "nonexistent",
        archivedBy: "admin-1",
        reason: "test",
      }),
    ).rejects.toThrow("DRIVER_NOT_FOUND");
  });

  it("rejects archive of already-archived driver", async () => {
    const doc = makeArchivedDriverDoc("already-archived");
    docGetResults.set("driverRegistry/already-archived", doc);

    await expect(
      archiveDriver({
        driverId: "already-archived",
        archivedBy: "admin-1",
        reason: "test",
      }),
    ).rejects.toThrow("DRIVER_ALREADY_ARCHIVED");
  });
});

// ---------------------------------------------------------------------------
// Restore tests
// ---------------------------------------------------------------------------

describe("restoreArchivedDriver", () => {
  it("restores an archived driver to previous eligibility, keeps offline", async () => {
    const driverId = "archived-driver";
    const doc = makeArchivedDriverDoc(driverId, {
      archivedPreviousEligibilityStatus: "eligible",
    });

    docGetResults.set(`driverRegistry/${driverId}`, doc);
    txnGetResults.set(`driverRegistry/${driverId}`, doc);

    await restoreArchivedDriver({ driverId, restoredBy: "admin-1" });

    expect(txnWrites).toContainEqual(
      expect.objectContaining({
        op: "update",
        path: `driverRegistry/${driverId}`,
        data: expect.objectContaining({
          eligibilityStatus: "eligible",
          availabilityStatus: "offline",
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          archivedPreviousEligibilityStatus: null,
          archivedPreviousIneligibilityReason: null,
        }),
      }),
    );
    // Verify audit event
    expect(txnWrites).toContainEqual(
      expect.objectContaining({
        op: "create",
        data: expect.objectContaining({
          type: "driver_restored_from_archive",
          actorId: "admin-1",
          metadata: expect.objectContaining({
            restoredToEligibilityStatus: "eligible",
          }),
        }),
      }),
    );
  });

  it("rejects restore of non-archived driver", async () => {
    const doc = makeActiveDriverDoc("not-archived");
    docGetResults.set("driverRegistry/not-archived", doc);

    await expect(
      restoreArchivedDriver({ driverId: "not-archived", restoredBy: "admin-1" }),
    ).rejects.toThrow("DRIVER_NOT_ARCHIVED");
  });
});

// ---------------------------------------------------------------------------
// Delete eligibility tests
// ---------------------------------------------------------------------------

describe("getDeleteDriverEligibility", () => {
  it("allows deletion of clean unlinked record with no references", async () => {
    const driverId = "clean-test-record";
    const doc = makeDriverDoc(driverId);
    docGetResults.set(`driverRegistry/${driverId}`, doc);

    const result: DeleteDriverEligibility = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("blocks deletion for linked account", async () => {
    const driverId = "linked-driver";
    const doc = makeDriverDoc(driverId, { linkedUserId: "user-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.linkedAccount).toBe(true);
    expect(result.reasons).toContainEqual(
      expect.stringContaining("linked application account"),
    );
  });

  it("blocks deletion for active request lock", async () => {
    const driverId = "locked-driver";
    const doc = makeDriverDoc(driverId, { activeRequestId: "req-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.activeRequestLock).toBe(true);
  });

  it("blocks deletion for meter assignments", async () => {
    const driverId = "metered-driver";
    const doc = makeDriverDoc(driverId);
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    collectionGetResults.set(`driverRegistry/${driverId}/meters`, {
      docs: [{ id: "bottom" }],
      size: 1,
      empty: false,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.meterAssignments).toBe(1);
    expect(result.reasons).toContainEqual(
      expect.stringContaining("meter assignment"),
    );
  });

  it("blocks deletion for registry audit events", async () => {
    const driverId = "driver-with-events";
    const doc = makeDriverDoc(driverId);
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    collectionGetResults.set(`driverRegistry/${driverId}/events`, {
      docs: [{ id: "event-1" }],
      size: 1,
      empty: false,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.registryEvents).toBe(1);
    expect(result.reasons).toContainEqual(
      expect.stringContaining("audit trail"),
    );
  });

  it("blocks deletion for historical assignments (linked driver)", async () => {
    const driverId = "driver-with-history";
    const doc = makeDriverDoc(driverId, { linkedUserId: "user-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    queryResults.set("waterRequests?assignedDriverId=user-1", {
      docs: [{ data: () => ({ status: "confirmed" }) }],
      size: 1,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.historicalAssignments).toBe(1);
    expect(result.reasons).toContainEqual(
      expect.stringContaining("historical water request"),
    );
  });

  it("blocks deletion for preferred driver references", async () => {
    const driverId = "preferred-driver";
    const doc = makeDriverDoc(driverId, { linkedUserId: "user-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    queryResults.set("waterRequests?preferredDriverId=user-1", {
      docs: [{ data: () => ({}) }],
      size: 1,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.preferredDriverReferences).toBe(1);
  });

  it("blocks deletion for dispatch batch memberships", async () => {
    const driverId = "batch-driver";
    const doc = makeDriverDoc(driverId, { linkedUserId: "user-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    queryResults.set("dispatchBatches?driverId=user-1", {
      docs: [{ data: () => ({}) }],
      size: 1,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.dispatchBatchMemberships).toBe(1);
  });

  it("blocks deletion for driver offer references", async () => {
    const driverId = "offered-driver";
    const doc = makeDriverDoc(driverId, { linkedUserId: "user-1" });
    docGetResults.set(`driverRegistry/${driverId}`, doc);
    queryResults.set("driverOffers?driverId=user-1", {
      docs: [{ data: () => ({}) }],
      size: 2,
    });

    const result = await getDeleteDriverEligibility(driverId);
    expect(result.canDelete).toBe(false);
    expect(result.summary.driverOfferReferences).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Delete action tests
// ---------------------------------------------------------------------------

describe("deleteDriver", () => {
  it("rejects deletion with name confirmation mismatch", async () => {
    const driverId = "driver-1";
    const doc = makeDriverDoc(driverId, { displayName: "Test Driver" });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);

    await expect(
      deleteDriver({
        driverId,
        deletedBy: "admin-1",
        confirmation: "Wrong Name",
      }),
    ).rejects.toThrow("CONFIRMATION_NAME_MISMATCH");
  });

  it("rejects deletion of linked driver", async () => {
    const driverId = "linked-driver";
    const doc = makeDriverDoc(driverId, {
      displayName: "Linked Driver",
      linkedUserId: "user-1",
    });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);

    await expect(
      deleteDriver({
        driverId,
        deletedBy: "admin-1",
        confirmation: "Linked Driver",
      }),
    ).rejects.toThrow("DRIVER_NOT_ELIGIBLE_FOR_DELETION");
  });

  it("rejects deletion of driver with active request lock", async () => {
    const driverId = "locked-driver";
    const doc = makeDriverDoc(driverId, {
      displayName: "Locked Driver",
      activeRequestId: "req-1",
    });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);

    await expect(
      deleteDriver({
        driverId,
        deletedBy: "admin-1",
        confirmation: "Locked Driver",
      }),
    ).rejects.toThrow("DRIVER_NOT_ELIGIBLE_FOR_DELETION");
  });

  it("rejects deletion of driver with meter assignments", async () => {
    const driverId = "metered-driver";
    const doc = makeDriverDoc(driverId, { displayName: "Metered Driver" });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);
    // Mock subcollection queries inside transaction
    const metersMock = { size: 1, docs: [{ id: "bottom" }] };
    const eventsMock = { size: 0, docs: [] };
    // The transaction get for subcollections is handled by txnGetResults too
    txnGetResults.set(`driverRegistry/${driverId}/meters`, metersMock);
    txnGetResults.set(`driverRegistry/${driverId}/events`, eventsMock);

    await expect(
      deleteDriver({
        driverId,
        deletedBy: "admin-1",
        confirmation: "Metered Driver",
      }),
    ).rejects.toThrow("DRIVER_NOT_ELIGIBLE_FOR_DELETION");
  });

  it("rejects deletion of driver with audit events", async () => {
    const driverId = "evented-driver";
    const doc = makeDriverDoc(driverId, { displayName: "Evented Driver" });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);
    txnGetResults.set(`driverRegistry/${driverId}/meters`, { size: 0, docs: [] });
    txnGetResults.set(`driverRegistry/${driverId}/events`, {
      size: 2,
      docs: [{ id: "e1" }, { id: "e2" }],
    });

    await expect(
      deleteDriver({
        driverId,
        deletedBy: "admin-1",
        confirmation: "Evented Driver",
      }),
    ).rejects.toThrow("DRIVER_NOT_ELIGIBLE_FOR_DELETION");
  });

  it("allows deletion of a clean test record with correct confirmation", async () => {
    const driverId = "clean-test";
    const doc = makeDriverDoc(driverId, { displayName: "Clean Test" });
    txnGetResults.set(`driverRegistry/${driverId}`, doc);
    txnGetResults.set(`driverRegistry/${driverId}/meters`, { size: 0, docs: [] });
    txnGetResults.set(`driverRegistry/${driverId}/events`, { size: 0, docs: [] });

    await deleteDriver({
      driverId,
      deletedBy: "admin-1",
      confirmation: "Clean Test",
    });

    // Should have deleted the driver doc and name key
    expect(txnWrites).toContainEqual(
      expect.objectContaining({ op: "delete", path: `driverRegistry/${driverId}` }),
    );
    expect(txnWrites).toContainEqual(
      expect.objectContaining({
        op: "delete",
        path: expect.stringContaining("driverRegistryUniqueKeys/"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Seed controls removal tests
// ---------------------------------------------------------------------------

describe("seed controls removal from production", () => {
  it("seedInitialRoster is not exported from driverRegistry module", async () => {
    const mod = await import("@/lib/domain/driverRegistry");
    expect("seedInitialRoster" in mod).toBe(false);
  });

  it("INITIAL_ROSTER is not exported from driverRegistry module", async () => {
    const mod = await import("@/lib/domain/driverRegistry");
    expect("INITIAL_ROSTER" in mod).toBe(false);
  });

  it("SeedInitialRosterResult is not exported from driverRegistry module", async () => {
    const mod = await import("@/lib/domain/driverRegistry");
    expect("SeedInitialRosterResult" in mod).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-record safety tests (Earl scenario)
// ---------------------------------------------------------------------------

describe("duplicate-looking records are not automatically merged or deleted", () => {
  it("two similarly-named drivers can both exist and be individually managed", async () => {
    const doc1 = makeDriverDoc("earl-1", {
      displayName: "Earl Ballentyne",
    });
    const doc2 = makeActiveDriverDoc("earl-2", {
      displayName: "Earl Ballantyne",
      linkedUserId: "earl-uid",
    });

    collectionGetResults.set("driverRegistry", { docs: [doc1, doc2] });
    const active = await getActiveDriverRegistryEntries();
    // Both should appear in active list (neither is archived)
    expect(active).toHaveLength(2);
    expect(active.map((d) => d.displayName)).toContain("Earl Ballentyne");
    expect(active.map((d) => d.displayName)).toContain("Earl Ballantyne");
  });
});
