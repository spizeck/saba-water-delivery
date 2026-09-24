/**
 * Canonical Firestore query/index contract (issue #113).
 *
 * This module is the repository's declarative inventory of every Firestore
 * query shape the application or its operator tooling can issue, plus the
 * composite index each shape requires (if any). The companion test
 * (`__tests__/indexContract.test.ts`) enforces three things:
 *
 *   1. Every `requiredIndex` in `QUERY_SHAPES` exists verbatim in
 *      `firestore.indexes.json`.
 *   2. Every manifest entry is either required by a registered query shape or
 *      explicitly retained in `RETAINED_INDEXES` with a justification.
 *   3. The real code paths produce the registered query shapes — the test
 *      drives domain functions against a recording Firestore fake so a query
 *      that drifts (a new `where`/`orderBy`) fails the contract.
 *
 * Index semantics applied here (Firebase docs: "Manage indexes",
 * "Query limitations"):
 *   - Equality-only filters (`==`, `in`, `array-contains`,
 *     `array-contains-any`), optionally ordered by document ID, are served by
 *     merging automatic single-field indexes — no composite needed, and a
 *     composite is actively invalid (see the issue-#96 deployment failure).
 *   - A single range/order field alone is served by its single-field index.
 *   - Equality + range/order, multiple order fields, or a range/order on a
 *     different field than the ordering requires a composite index.
 *   - A range filter without an explicit `orderBy` implicitly orders by that
 *     field ASCENDING then document ID ascending.
 *
 * What this contract does NOT cover: collectionGroup() queries (none exist
 * today) and queries built outside the audited modules — see
 * docs/DEPLOYMENT.md "Firestore indexes" for the audit procedure.
 */

export const DOC_ID_FIELD = "__name__";

export type QueryFilterOp =
  | "=="
  | "!="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any"
  | "<"
  | "<="
  | ">"
  | ">=";

export type OrderDirection = "asc" | "desc";
export type IndexOrder = "ASCENDING" | "DESCENDING";

export interface QueryFilterSpec {
  fieldPath: string;
  op: QueryFilterOp;
}

export interface QueryOrderSpec {
  fieldPath: string;
  direction: OrderDirection;
}

export interface IndexFieldSpec {
  fieldPath: string;
  order: IndexOrder;
}

export interface QueryShapeSpec {
  /** Stable identifier, e.g. "driverOffers/recent-declines-unordered". */
  id: string;
  /**
   * Collection path pattern. `{placeholder}` segments match any document id,
   * e.g. "waterRequests/{requestId}/events".
   */
  collectionPath: string;
  /** Filters, in the order the code applies them (order-insensitive match). */
  filters: QueryFilterSpec[];
  orderBy: QueryOrderSpec[];
  /**
   * Exact composite index required by this shape, or null when automatic
   * single-field indexes (including index merging) suffice.
   */
  requiredIndex: IndexFieldSpec[] | null;
  usedBy: { file: string; functions: string[] }[];
  /**
   * "shape-asserted": a unit test drives the code path and asserts the
   * produced shape equals this entry. "declared": the shape is registered
   * from code review only (e.g. a query nested inside a heavy transaction
   * that the test does not drive).
   */
  verification: "shape-asserted" | "declared";
  note?: string;
}

/** Deployed manifest entries no current query requires, retained on purpose. */
export interface RetainedIndexSpec {
  collectionGroup: string;
  fields: IndexFieldSpec[];
  reason: string;
}

const EQUALITY_OPS: ReadonlySet<QueryFilterOp> = new Set([
  "==",
  "in",
  "array-contains",
  "array-contains-any",
]);

const asc = (fieldPath: string): IndexFieldSpec => ({
  fieldPath,
  order: "ASCENDING",
});
const desc = (fieldPath: string): IndexFieldSpec => ({
  fieldPath,
  order: "DESCENDING",
});

/** Last path segment — the collection group an index targets. */
export function collectionGroupOf(collectionPath: string): string {
  return collectionPath.split("/").filter(Boolean).pop() ?? collectionPath;
}

/**
 * Order-insensitive canonical signature of a query shape. `orderBy` stays
 * ordered because ordering order is semantically significant; filters are
 * sorted because `where` order does not change the required index.
 */
export function shapeSignature(
  spec: Pick<QueryShapeSpec, "collectionPath" | "filters" | "orderBy">,
): string {
  const filters = spec.filters
    .map((f) => `${f.fieldPath}${f.op}`)
    .sort()
    .join(",");
  const orderBy = spec.orderBy
    .map((o) => `${o.fieldPath}:${o.direction}`)
    .join(",");
  return `${spec.collectionPath} [${filters}] => [${orderBy}]`;
}

/** Canonical signature of an index field list. */
export function indexSignature(
  collectionGroup: string,
  fields: IndexFieldSpec[],
): string {
  return `${collectionGroup} :: ${fields
    .map((f) => `${f.fieldPath}:${f.order}`)
    .join("|")}`;
}

/**
 * Whether Firestore requires a composite index for this shape. Deliberately
 * conservative about what does NOT need one so the registry cannot repeat the
 * issue-#96 mistake (a composite `status + __name__` that Firebase rejects
 * because merged single-field indexes already serve the query).
 */
export function shapeRequiresCompositeIndex(
  spec: Pick<QueryShapeSpec, "filters" | "orderBy">,
): boolean {
  const eq = new Set(
    spec.filters.filter((f) => EQUALITY_OPS.has(f.op)).map((f) => f.fieldPath),
  );
  const ineq = new Set(
    spec.filters.filter((f) => !EQUALITY_OPS.has(f.op)).map((f) => f.fieldPath),
  );
  const orderedFields = spec.orderBy.filter(
    (o) => o.fieldPath !== DOC_ID_FIELD,
  );

  // Equality-only, optionally ordered by document ID: merged single-field
  // indexes serve this — a composite is invalid.
  if (ineq.size === 0 && orderedFields.length === 0) return false;

  if (eq.size === 0) {
    // Range filters with no explicit ordering: implicit ascending order on
    // the first inequality field, then document ID. Multiple distinct
    // inequality fields need a composite; one does not.
    if (orderedFields.length === 0) return ineq.size > 1;
    // A single ordering on the same field as the only range filter is still
    // a single-field index case (e.g. `requestedAt >= X orderBy requestedAt`).
    if (
      orderedFields.length === 1 &&
      ineq.size <= 1 &&
      (ineq.size === 0 || ineq.has(orderedFields[0].fieldPath))
    ) {
      return false;
    }
    // Multiple order fields, or ordering on a field different from the range
    // filter, requires a composite.
    return true;
  }

  // At least one equality filter:
  // - plus a range filter and no explicit ordering → composite (implicit
  //   ascending order) — this is the issue-#113 incident shape.
  // - plus any explicit data-field ordering → composite.
  if (orderedFields.length === 0) return ineq.size >= 1;
  return true;
}

/**
 * The composite index Firestore semantics imply for a shape, in canonical
 * form: equality fields ASCENDING (alphabetical), then ordered/range fields in
 * effective order, then document ID with the direction of the last ordering.
 * Used to validate that each declared `requiredIndex` is consistent with its
 * shape — declared indexes may list equality fields in any order (Firestore
 * does not care), so the test compares equality fields as a set.
 */
export function expectedIndexFields(
  spec: Pick<QueryShapeSpec, "filters" | "orderBy">,
): IndexFieldSpec[] | null {
  if (!shapeRequiresCompositeIndex(spec)) return null;

  const eq = [
    ...new Set(
      spec.filters
        .filter((f) => EQUALITY_OPS.has(f.op))
        .map((f) => f.fieldPath),
    ),
  ].sort();
  const ineq = [
    ...new Set(
      spec.filters
        .filter((f) => !EQUALITY_OPS.has(f.op))
        .map((f) => f.fieldPath),
    ),
  ];
  const orderedFields = spec.orderBy.filter(
    (o) => o.fieldPath !== DOC_ID_FIELD,
  );

  const effectiveOrder: IndexFieldSpec[] =
    orderedFields.length > 0
      ? orderedFields.map((o) => ({
          fieldPath: o.fieldPath,
          order: o.direction === "desc" ? "DESCENDING" : "ASCENDING",
        }))
      : ineq.map((fieldPath) => ({ fieldPath, order: "ASCENDING" }));

  const lastDirection = effectiveOrder[effectiveOrder.length - 1]?.order;
  return [
    ...eq.map(asc),
    ...effectiveOrder,
    { fieldPath: DOC_ID_FIELD, order: lastDirection ?? "ASCENDING" },
  ];
}

/**
 * Whether a recorded collection path matches a registry pattern where
 * `{placeholder}` segments are wildcards, e.g. "waterRequests/{id}/events".
 */
export function collectionPathMatches(
  pattern: string,
  actual: string,
): boolean {
  const p = pattern.split("/");
  const a = actual.split("/");
  if (p.length !== a.length) return false;
  return p.every(
    (seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === a[i],
  );
}

// ---------------------------------------------------------------------------
// Query-shape registry
// ---------------------------------------------------------------------------

export const QUERY_SHAPES: QueryShapeSpec[] = [
  // ── driverOffers ───────────────────────────────────────────────────────
  {
    id: "driverOffers/pending-for-driver",
    collectionPath: "driverOffers",
    filters: [
      { fieldPath: "driverId", op: "==" },
      { fieldPath: "response", op: "==" },
    ],
    orderBy: [{ fieldPath: "offeredAt", direction: "desc" }],
    requiredIndex: [
      asc("driverId"),
      asc("response"),
      desc("offeredAt"),
      desc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/driverOffers.ts",
        functions: ["expirePendingOffersForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverOffers/declined-history",
    collectionPath: "driverOffers",
    filters: [
      { fieldPath: "driverId", op: "==" },
      { fieldPath: "response", op: "==" },
      { fieldPath: "respondedAt", op: ">=" },
    ],
    orderBy: [{ fieldPath: "respondedAt", direction: "desc" }],
    requiredIndex: [
      asc("driverId"),
      asc("response"),
      desc("respondedAt"),
      desc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/driverOffers.ts",
        functions: ["getDeclinedRequestIdsForDriver"],
      },
    ],
    verification: "shape-asserted",
    note: "Re-offer loop protection; same filters as the incident shape but explicitly ordered newest-first.",
  },
  {
    id: "driverOffers/recent-declines-unordered",
    collectionPath: "driverOffers",
    filters: [
      { fieldPath: "driverId", op: "==" },
      { fieldPath: "response", op: "==" },
      { fieldPath: "respondedAt", op: ">=" },
    ],
    orderBy: [],
    requiredIndex: [
      asc("driverId"),
      asc("response"),
      asc("respondedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/driverOffers.ts",
        functions: ["countDeclinesToday"],
      },
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["releaseAssignedDelivery"],
      },
    ],
    verification: "shape-asserted",
    note: "Issue #113 incident: a range filter with no orderBy implicitly orders by respondedAt ASCENDING + document ID, so the DESCENDING index cannot serve it. Production requested this exact index; it was created manually in the Console.",
  },
  {
    id: "driverOffers/pending-for-request",
    collectionPath: "driverOffers",
    filters: [
      { fieldPath: "driverId", op: "==" },
      { fieldPath: "requestId", op: "==" },
      { fieldPath: "response", op: "==" },
    ],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["releaseAssignedDelivery"],
      },
    ],
    verification: "shape-asserted",
    note: "Equality-only legacy pending-offer sweep inside the release transaction; merged single-field indexes suffice.",
  },
  {
    id: "driverOffers/offer-window-scan",
    collectionPath: "driverOffers",
    filters: [{ fieldPath: "offeredAt", op: ">=" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverOffers.ts",
        functions: ["getOfferAggregate"],
      },
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverOffers/full-scan",
    collectionPath: "driverOffers",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverOffers.ts",
        functions: ["getOfferAggregate"],
      },
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverOffers/by-driver",
    collectionPath: "driverOffers",
    filters: [{ fieldPath: "driverId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },

  // ── waterRequests ─────────────────────────────────────────────────────
  {
    id: "waterRequests/active-for-customer",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "customerId", op: "==" },
      { fieldPath: "status", op: "in" },
    ],
    orderBy: [{ fieldPath: "requestedAt", direction: "desc" }],
    requiredIndex: [
      asc("customerId"),
      asc("status"),
      desc("requestedAt"),
      desc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getActiveRequestForCustomer"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/history-for-customer",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "customerId", op: "==" }],
    orderBy: [{ fieldPath: "requestedAt", direction: "desc" }],
    requiredIndex: [asc("customerId"), desc("requestedAt"), desc(DOC_ID_FIELD)],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getRequestsForCustomer"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/latest-confirmed-for-customer",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "customerId", op: "==" },
      { fieldPath: "status", op: "==" },
    ],
    orderBy: [{ fieldPath: "confirmedAt", direction: "desc" }],
    requiredIndex: [
      asc("customerId"),
      asc("status"),
      desc("confirmedAt"),
      desc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getMostRecentConfirmedRequest"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/active-statuses",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "status", op: "in" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getActiveCustomerIds"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
      {
        file: "scripts/production-integrity.mjs",
        functions: ["main"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/active-for-customer-unordered",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "customerId", op: "==" },
      { fieldPath: "status", op: "in" },
    ],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["createWaterRequest"],
      },
    ],
    verification: "shape-asserted",
    note: "Hard one-active-request invariant enforced inside the create transaction; equality-only → merged indexes.",
  },
  {
    id: "waterRequests/delivered-for-customer",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "customerId", op: "==" },
      { fieldPath: "status", op: "==" },
    ],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["createWaterRequest"],
      },
    ],
    verification: "shape-asserted",
    note: "Stale-delivery pre-check before creating a request.",
  },
  {
    id: "waterRequests/active-by-phone",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "customer.phone", op: "==" },
      { fieldPath: "status", op: "in" },
    ],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["findActiveRequestsByPhone"],
      },
    ],
    verification: "shape-asserted",
    note: "Equality-only → merged single-field indexes. The deployed customer.phone+status+__name__ composite is retained for parity (see RETAINED_INDEXES) but is not required.",
  },
  {
    id: "waterRequests/claimed-for-driver",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "assignedDriverId", op: "==" },
      { fieldPath: "status", op: "==" },
    ],
    orderBy: [{ fieldPath: "claimedAt", direction: "desc" }],
    requiredIndex: [
      asc("assignedDriverId"),
      asc("status"),
      desc("claimedAt"),
      desc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getClaimedRequestsForDriver"],
      },
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/claimed-for-driver-probe",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "assignedDriverId", op: "==" },
      { fieldPath: "status", op: "==" },
    ],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["claimWaterRequest"],
      },
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["dispatcherAssignRequest", "dispatcherReassignRequest"],
      },
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["reconcileActiveRequestByUserId"],
      },
    ],
    verification: "declared",
    note: "limit(1) existence probe inside claim/assign transactions; equality-only.",
  },
  {
    id: "waterRequests/batch-eligible",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "status", op: "in" }],
    orderBy: [
      { fieldPath: "priorityRank", direction: "asc" },
      { fieldPath: "requestedAt", direction: "asc" },
    ],
    requiredIndex: [
      asc("status"),
      asc("priorityRank"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getBatchEligibleRequests"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/batch-members",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "dispatchBatchId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: [
          "getRequestsForDispatchBatch",
          "getAllDispatchBatchSummaries",
          "closeDeliveryRun",
        ],
      },
      {
        file: "src/lib/domain/dispatchBatches.ts",
        functions: ["getAllDispatchBatchSummaries"],
      },
    ],
    verification: "shape-asserted",
    note: "Members are deliberately sorted in memory by batchSequence (see waterRequests.ts ~L437); the deployed dispatchBatchId+batchSequence+__name__ composite is retained but not required.",
  },
  {
    id: "waterRequests/hold-expiry",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "preferredDriverExpiresAt", op: "<=" },
    ],
    orderBy: [],
    requiredIndex: [
      asc("status"),
      asc("preferredDriverExpiresAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["expirePreferredDriverHolds"],
      },
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/dispatch-ranked-hold",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "preferredDriverId", op: "==" },
      { fieldPath: "dispatchPriority", op: "==" },
      { fieldPath: "dispatchOverrideRank", op: "!=" },
    ],
    orderBy: [
      { fieldPath: "dispatchOverrideRank", direction: "asc" },
      { fieldPath: "requestedAt", direction: "asc" },
      { fieldPath: DOC_ID_FIELD, direction: "asc" },
    ],
    requiredIndex: [
      asc("status"),
      asc("preferredDriverId"),
      asc("dispatchPriority"),
      asc("dispatchOverrideRank"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/dispatch-byage-hold",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "preferredDriverId", op: "==" },
      { fieldPath: "dispatchPriority", op: "==" },
    ],
    orderBy: [
      { fieldPath: "requestedAt", direction: "asc" },
      { fieldPath: DOC_ID_FIELD, direction: "asc" },
    ],
    requiredIndex: [
      asc("status"),
      asc("preferredDriverId"),
      asc("dispatchPriority"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/dispatch-catchall-hold",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "preferredDriverId", op: "==" },
    ],
    orderBy: [{ fieldPath: DOC_ID_FIELD, direction: "asc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
    note: "Two equalities + document-ID ordering are served by merged single-field indexes; a composite here would be rejected for the same reason as the issue-#96 index. The deployed equivalent is retained for parity.",
  },
  {
    id: "waterRequests/dispatch-ranked-available",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "dispatchPriority", op: "==" },
      { fieldPath: "dispatchOverrideRank", op: "!=" },
    ],
    orderBy: [
      { fieldPath: "dispatchOverrideRank", direction: "asc" },
      { fieldPath: "requestedAt", direction: "asc" },
      { fieldPath: DOC_ID_FIELD, direction: "asc" },
    ],
    requiredIndex: [
      asc("status"),
      asc("dispatchPriority"),
      asc("dispatchOverrideRank"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/dispatch-byage-available",
    collectionPath: "waterRequests",
    filters: [
      { fieldPath: "status", op: "==" },
      { fieldPath: "dispatchPriority", op: "==" },
    ],
    orderBy: [
      { fieldPath: "requestedAt", direction: "asc" },
      { fieldPath: DOC_ID_FIELD, direction: "asc" },
    ],
    requiredIndex: [
      asc("status"),
      asc("dispatchPriority"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/dispatch-catchall-available",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "status", op: "==" }],
    orderBy: [{ fieldPath: DOC_ID_FIELD, direction: "asc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
    note: "Exactly the shape the invalid issue-#96 status+__name__ composite claimed to serve; merged single-field indexes cover it.",
  },
  {
    id: "waterRequests/all-recent-first",
    collectionPath: "waterRequests",
    filters: [],
    orderBy: [{ fieldPath: "requestedAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getAllRequests", "getFrequentRequestCountForCustomer"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/outstanding-continuity",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "status", op: "in" }],
    orderBy: [{ fieldPath: "requestedAt", direction: "asc" }],
    requiredIndex: [asc("status"), asc("requestedAt"), asc(DOC_ID_FIELD)],
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getOutstandingRequestsForContinuityReport"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/full-scan",
    collectionPath: "waterRequests",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
      {
        file: "scripts/production-integrity.mjs",
        functions: ["main"],
      },
    ],
    verification: "shape-asserted",
    note: "Unbounded collection read for current-state metrics and integrity checks; no index involved.",
  },
  {
    id: "waterRequests/stats-window",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "requestedAt", op: ">=" }],
    orderBy: [{ fieldPath: "requestedAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
    ],
    verification: "shape-asserted",
    note: "Range on the same field as the ordering → single-field index.",
  },
  {
    id: "waterRequests/events-chronological",
    collectionPath: "waterRequests/{requestId}/events",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "asc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/waterRequests.ts",
        functions: ["getRequestEvents"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/events-by-type",
    collectionPath: "waterRequests/{requestId}/events",
    filters: [{ fieldPath: "type", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
    ],
    verification: "declared",
  },
  {
    id: "waterRequests/events-by-types",
    collectionPath: "waterRequests/{requestId}/events",
    filters: [{ fieldPath: "type", op: "in" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
    ],
    verification: "declared",
  },
  {
    id: "waterRequests/by-customer-count",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "customerId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/identity.ts",
        functions: ["getAccountMergePreview", "mergeUserAccounts"],
      },
    ],
    verification: "declared",
  },
  {
    id: "waterRequests/unregistered-scan",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "customerId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/identity.ts",
        functions: ["findPossibleRequestHistoryMatchesForUser"],
      },
    ],
    verification: "shape-asserted",
    note: "customerId == null unregistered-request scan for the admin link-history workflow.",
  },
  {
    id: "waterRequests/by-assigned-driver",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "assignedDriverId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "waterRequests/by-preferred-driver",
    collectionPath: "waterRequests",
    filters: [{ fieldPath: "preferredDriverId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },

  // ── dispatchBatches ────────────────────────────────────────────────────
  {
    id: "dispatchBatches/recent-first",
    collectionPath: "dispatchBatches",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/dispatchBatches.ts",
        functions: ["getAllDispatchBatches"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "dispatchBatches/events-chronological",
    collectionPath: "dispatchBatches/{batchId}/events",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "asc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/dispatchBatches.ts",
        functions: ["getDispatchBatchEvents"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "dispatchBatches/by-driver",
    collectionPath: "dispatchBatches",
    filters: [{ fieldPath: "driverId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },

  // ── driverRegistry ─────────────────────────────────────────────────────
  {
    id: "driverRegistry/by-linked-user",
    collectionPath: "driverRegistry",
    filters: [{ fieldPath: "linkedUserId", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: [
          "getDriverByLinkedUserId",
          "reconcileActiveRequestByUserId",
        ],
      },
      {
        file: "src/lib/domain/dispatch.ts",
        functions: ["assignNextDeliveryForDriver"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverRegistry/by-linked-users",
    collectionPath: "driverRegistry",
    filters: [{ fieldPath: "linkedUserId", op: "in" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/admin.ts",
        functions: ["getAllUsers"],
      },
      {
        file: "src/lib/domain/statistics.ts",
        functions: ["getStatistics"],
      },
    ],
    verification: "declared",
  },
  {
    id: "driverRegistry/all",
    collectionPath: "driverRegistry",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getAllDriverRegistryEntries"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverRegistry/events-recent",
    collectionPath: "driverRegistry/{driverId}/events",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getDriverEvents", "getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "driverRegistry/meters-all",
    collectionPath: "driverRegistry/{driverId}/meters",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/driverRegistry.ts",
        functions: ["getMeterAssignments", "getDeleteDriverEligibility"],
      },
    ],
    verification: "shape-asserted",
  },

  // ── notificationOutbox ─────────────────────────────────────────────────
  {
    id: "notificationOutbox/pending-due",
    collectionPath: "notificationOutbox",
    filters: [
      { fieldPath: "state", op: "==" },
      { fieldPath: "nextAttemptAt", op: "<=" },
    ],
    orderBy: [
      { fieldPath: "nextAttemptAt", direction: "asc" },
      { fieldPath: "createdAt", direction: "asc" },
    ],
    requiredIndex: [
      asc("state"),
      asc("nextAttemptAt"),
      asc("createdAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/notifications/worker.ts",
        functions: ["processNotificationOutbox"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "notificationOutbox/expired-leases",
    collectionPath: "notificationOutbox",
    filters: [
      { fieldPath: "state", op: "==" },
      { fieldPath: "leaseExpiresAt", op: "<=" },
    ],
    orderBy: [{ fieldPath: "leaseExpiresAt", direction: "asc" }],
    requiredIndex: [asc("state"), asc("leaseExpiresAt"), asc(DOC_ID_FIELD)],
    usedBy: [
      {
        file: "src/lib/notifications/worker.ts",
        functions: ["processNotificationOutbox"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "notificationOutbox/by-state-newest",
    collectionPath: "notificationOutbox",
    filters: [{ fieldPath: "state", op: "==" }],
    orderBy: [{ fieldPath: "createdAt", direction: "desc" }],
    requiredIndex: [asc("state"), desc("createdAt"), desc(DOC_ID_FIELD)],
    usedBy: [
      {
        file: "src/lib/notifications/outboxAdmin.ts",
        functions: ["listNotificationsByState"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "notificationOutbox/state-count",
    collectionPath: "notificationOutbox",
    filters: [{ fieldPath: "state", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/notifications/outboxAdmin.ts",
        functions: ["getOutboxStateCounts"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "notificationOutbox/delivery-events-scan",
    collectionPath: "notificationOutbox/{messageId}/deliveryEvents",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/notifications/outboxAdmin.ts",
        functions: ["getNotificationDetail"],
      },
      {
        file: "src/lib/notifications/worker.ts",
        functions: ["processNotificationOutbox"],
      },
    ],
    verification: "declared",
  },

  // ── accountMergeEvents ─────────────────────────────────────────────────
  {
    id: "accountMergeEvents/due-pending",
    collectionPath: "accountMergeEvents",
    filters: [
      { fieldPath: "authReconciliation.state", op: "==" },
      { fieldPath: "authReconciliation.nextAttemptAt", op: "<=" },
    ],
    orderBy: [
      { fieldPath: "authReconciliation.nextAttemptAt", direction: "asc" },
    ],
    requiredIndex: [
      asc("authReconciliation.state"),
      asc("authReconciliation.nextAttemptAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["processMergeAuthReconciliation"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/expired-leases",
    collectionPath: "accountMergeEvents",
    filters: [
      { fieldPath: "authReconciliation.state", op: "==" },
      { fieldPath: "authReconciliation.leaseExpiresAt", op: "<=" },
    ],
    orderBy: [
      { fieldPath: "authReconciliation.leaseExpiresAt", direction: "asc" },
    ],
    requiredIndex: [
      asc("authReconciliation.state"),
      asc("authReconciliation.leaseExpiresAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["processMergeAuthReconciliation"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/active-lease-count",
    collectionPath: "accountMergeEvents",
    filters: [
      { fieldPath: "authReconciliation.state", op: "==" },
      { fieldPath: "authReconciliation.leaseExpiresAt", op: ">" },
    ],
    orderBy: [],
    requiredIndex: [
      asc("authReconciliation.state"),
      asc("authReconciliation.leaseExpiresAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getMergeReconciliationOverview"],
      },
    ],
    verification: "shape-asserted",
    note: "Equality + range without orderBy implicitly orders leaseExpiresAt ascending → same composite as expired-leases.",
  },
  {
    id: "accountMergeEvents/stale-lease-count",
    collectionPath: "accountMergeEvents",
    filters: [
      { fieldPath: "authReconciliation.state", op: "==" },
      { fieldPath: "authReconciliation.leaseExpiresAt", op: "<=" },
    ],
    orderBy: [],
    requiredIndex: [
      asc("authReconciliation.state"),
      asc("authReconciliation.leaseExpiresAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getMergeReconciliationOverview"],
      },
    ],
    verification: "shape-asserted",
    note: "Shares the expired-leases composite index (implicit ascending order on the range field).",
  },
  {
    id: "accountMergeEvents/unresolved-oldest",
    collectionPath: "accountMergeEvents",
    filters: [{ fieldPath: "duplicateAuthDeleted", op: "==" }],
    orderBy: [{ fieldPath: "createdAt", direction: "asc" }],
    requiredIndex: [
      asc("duplicateAuthDeleted"),
      asc("createdAt"),
      asc(DOC_ID_FIELD),
    ],
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: [
          "listUnresolvedMergeReconciliations",
          "processMergeAuthReconciliation",
        ],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/unresolved-count",
    collectionPath: "accountMergeEvents",
    filters: [{ fieldPath: "duplicateAuthDeleted", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getMergeReconciliationOverview"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/state-count",
    collectionPath: "accountMergeEvents",
    filters: [{ fieldPath: "authReconciliation.state", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getMergeReconciliationOverview"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/recent-first",
    collectionPath: "accountMergeEvents",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getRecentAccountMergeEvents"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "accountMergeEvents/errors-scan",
    collectionPath: "accountMergeEvents/{eventId}/errors",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/mergeReconciliation.ts",
        functions: ["getMergeReconciliationDetail"],
      },
    ],
    verification: "declared",
  },

  // ── users ──────────────────────────────────────────────────────────────
  {
    id: "users/by-phone",
    collectionPath: "users",
    filters: [{ fieldPath: "phone", op: "==" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/users.ts",
        functions: ["findUsersByPhone"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "users/admins",
    collectionPath: "users",
    filters: [{ fieldPath: "roles", op: "array-contains" }],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/admin.ts",
        functions: ["countAdmins", "updateUserRoles"],
      },
    ],
    verification: "shape-asserted",
    note: "Last-admin invariant population read (also inside the role-update transaction).",
  },
  {
    id: "users/all",
    collectionPath: "users",
    filters: [],
    orderBy: [],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/admin.ts",
        functions: ["getAllUsers"],
      },
      {
        file: "src/lib/domain/users.ts",
        functions: ["getResidentDirectory"],
      },
      {
        file: "scripts/lib/integrity-scan.mjs",
        functions: ["assembleDataset"],
      },
    ],
    verification: "shape-asserted",
  },
  {
    id: "users/role-events-recent",
    collectionPath: "users/{uid}/roleEvents",
    filters: [],
    orderBy: [{ fieldPath: "createdAt", direction: "desc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/users.ts",
        functions: ["getRoleEvents"],
      },
    ],
    verification: "shape-asserted",
  },

  // ── fillStations ───────────────────────────────────────────────────────
  {
    id: "fillStations/by-name",
    collectionPath: "fillStations",
    filters: [],
    orderBy: [{ fieldPath: "name", direction: "asc" }],
    requiredIndex: null,
    usedBy: [
      {
        file: "src/lib/domain/fillStations.ts",
        functions: ["getFillStations"],
      },
    ],
    verification: "shape-asserted",
  },
];

/**
 * Manifest entries no registered query requires but which are deployed in
 * production. They are kept (rather than removed) because removal changes the
 * deployed index set; each entry documents why it is not required and remains
 * a deliberate parity decision, not drift. Removing them from the manifest
 * would cause `firebase deploy --only firestore:indexes` to delete them in
 * production — that decision belongs to an explicit cleanup change, not this
 * audit.
 */
export const RETAINED_INDEXES: RetainedIndexSpec[] = [
  {
    collectionGroup: "waterRequests",
    fields: [asc("customer.phone"), asc("status"), asc(DOC_ID_FIELD)],
    reason:
      "waterRequests/active-by-phone is equality-only — merged single-field indexes suffice. Deployed; retained for parity.",
  },
  {
    collectionGroup: "waterRequests",
    fields: [asc("status"), asc("preferredDriverId"), asc(DOC_ID_FIELD)],
    reason:
      "waterRequests/dispatch-catchall-hold is two equalities ordered by document ID — merged single-field indexes suffice. Deployed; retained for parity.",
  },
  {
    collectionGroup: "waterRequests",
    fields: [
      asc("status"),
      asc("preferredDriverId"),
      asc("priorityRank"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    reason:
      "No current query orders preferred-driver holds by priorityRank (post-#66 dispatch uses dispatchPriority + dispatchOverrideRank). Deployed; retained for parity.",
  },
  {
    collectionGroup: "waterRequests",
    fields: [
      asc("status"),
      asc("preferredDriverId"),
      asc("requestedAt"),
      asc(DOC_ID_FIELD),
    ],
    reason:
      "No current query uses this ordering — preferred-driver hold streams order by dispatchOverrideRank/requestedAt within dispatchPriority. Deployed; retained for parity.",
  },
  {
    collectionGroup: "waterRequests",
    fields: [asc("dispatchBatchId"), asc("batchSequence"), asc(DOC_ID_FIELD)],
    reason:
      "getRequestsForDispatchBatch deliberately fetches by dispatchBatchId alone and sorts batchSequence in memory (waterRequests.ts ~L437); no query orders by batchSequence. Deployed; retained for parity.",
  },
];

/**
 * Collections the application touches only through document reads/writes
 * (no collection queries), audited for completeness: whatsappSessions,
 * whatsappProcessedMessages, config/dispatchSettings (+ its events
 * subcollection, written inside transactions), systemInvariants, rateLimits,
 * uniqueKeys. Query-free by construction.
 */
