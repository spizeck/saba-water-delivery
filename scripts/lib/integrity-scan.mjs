/**
 * Bounded, READ-ONLY dataset assembly for the production integrity diagnostic
 * (issue #52). Splits cleanly into:
 *
 *   - `makeFirestoreReader(db)` — the ONLY place that touches Firestore. It uses
 *     nothing but reads (`.get()`, `.limit()`, `.startAfter()`, `getAll`),
 *     paginating with document-snapshot cursors internally and returning plain
 *     field-picked objects. It performs NO writes of any kind.
 *   - `assembleDataset(reader, options)` — a pure orchestration over that reader
 *     interface (so it is unit-testable with a fake reader and, via a fake db
 *     that throws on any write, provably read-only).
 *
 * Bounding strategy (why this cannot produce false "missing" findings):
 *   - `driverRegistry`, `users`, `dispatchBatches` are paginated fully (bounded
 *     by the government roster / user population), each capped by `maxRecords`.
 *   - `waterRequests` — the one collection that grows with history — is, by
 *     default (operational mode), queried for ACTIVE statuses only; a
 *     `--full-scan` reads the entire collection. Either way it is capped by
 *     `maxRecords`.
 *   - Every request referenced by a loaded driver's `activeRequestId` or a
 *     loaded batch's `originalRequestIds` that was NOT already loaded is then
 *     fetched by id. So a check that looks for a "missing" referenced request
 *     only fires when the document genuinely does not exist — never merely
 *     because operational-mode pagination skipped terminal history.
 *   - `maxRecords` bounds the TOTAL waterRequests documents read — the initial
 *     scan PLUS that referenced-request backfill — not each phase separately.
 *     Referenced ids beyond the remaining budget are left UNRESOLVED rather than
 *     read; they are reported (`counts.requestsUnresolvedByBudget`), they mark
 *     the waterRequests scan truncated, and they are handed to the checks as
 *     `unresolvedRequestIds` so an unread reference is treated as "not scanned",
 *     NEVER as "missing".
 *   - If any capped read is truncated, the run is reported as `truncated` and
 *     must not be treated as a globally clean bill of health.
 *
 * NOTE on the exact count: to DETECT truncation, `paginateQuery` may peek one
 * document beyond the cap (a standard N+1 probe); that peeked doc is never
 * loaded or examined. The bound governs documents read into the dataset.
 */

export const DRIVER_FIELDS = ["linkedUserId", "activeRequestId", "archivedAt"];
export const REQUEST_FIELDS = [
  "status",
  "assignedDriverId",
  "customerId",
  "dispatchBatchId",
  "preferredDriverId",
];
export const BATCH_FIELDS = ["originalRequestIds", "status", "driverId"];
export const USER_FIELDS = ["roles"];

/** Request statuses that represent live/operational (unresolved) work. */
export const ACTIVE_REQUEST_STATUSES = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "disputed",
];

export const DEFAULT_PAGE_SIZE = 300;
export const DEFAULT_MAX_RECORDS = 50_000;

function pickFields(id, data, fields) {
  /** @type {Record<string, unknown>} */
  const picked = { id };
  for (const field of fields) picked[field] = data[field] ?? null;
  return picked;
}

/**
 * Wraps a Firestore `db` in the read-only reader interface used by
 * `assembleDataset`. Touches Firestore only through read APIs.
 */
export function makeFirestoreReader(db) {
  async function paginateQuery(baseQuery, { fields, pageSize, maxRecords }) {
    /** @type {Record<string, unknown>[]} */
    const docs = [];
    let cursor = null;
    let truncated = false;
    for (;;) {
      const remaining = maxRecords - docs.length;
      if (remaining <= 0) {
        // Peek one more to know whether we stopped short of the end.
        const peek = await (cursor ? baseQuery.startAfter(cursor) : baseQuery)
          .limit(1)
          .get();
        truncated = !peek.empty;
        break;
      }
      const limit = Math.min(pageSize, remaining);
      let q = baseQuery.limit(limit);
      if (cursor) q = baseQuery.startAfter(cursor).limit(limit);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs)
        docs.push(pickFields(doc.id, doc.data(), fields));
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < limit) break; // reached the end
    }
    return { docs, truncated };
  }

  return {
    /** Paginate an entire collection (bounded by maxRecords). */
    async paginate(name, opts) {
      return paginateQuery(db.collection(name), opts);
    },
    /** Query only requests in the given statuses (operational mode). */
    async queryByStatusIn(name, statuses, opts) {
      return paginateQuery(
        db.collection(name).where("status", "in", statuses),
        opts,
      );
    },
    /** Fetch specific documents by id (for referenced-doc resolution). */
    async getByIds(name, ids, fields) {
      if (ids.length === 0) return [];
      const col = db.collection(name);
      /** @type {Record<string, unknown>[]} */
      const out = [];
      const CHUNK = 300;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const refs = ids.slice(i, i + CHUNK).map((id) => col.doc(id));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
          if (snap.exists) out.push(pickFields(snap.id, snap.data(), fields));
        }
      }
      return out;
    },
  };
}

/**
 * Assembles the bounded dataset the integrity checks operate on, resolving
 * referenced requests so pagination cannot cause false "missing" findings.
 *
 * @param reader an object matching the `makeFirestoreReader` interface
 * @param {{ fullScan?: boolean, pageSize?: number, maxRecords?: number }} options
 */
export async function assembleDataset(reader, options = {}) {
  const fullScan = Boolean(options.fullScan);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const pageOpts = { pageSize, maxRecords };

  const drivers = await reader.paginate("driverRegistry", {
    ...pageOpts,
    fields: DRIVER_FIELDS,
  });
  const users = await reader.paginate("users", {
    ...pageOpts,
    fields: USER_FIELDS,
  });
  const batches = await reader.paginate("dispatchBatches", {
    ...pageOpts,
    fields: BATCH_FIELDS,
  });

  const requests = fullScan
    ? await reader.paginate("waterRequests", {
        ...pageOpts,
        fields: REQUEST_FIELDS,
      })
    : await reader.queryByStatusIn("waterRequests", ACTIVE_REQUEST_STATUSES, {
        ...pageOpts,
        fields: REQUEST_FIELDS,
      });

  // Resolve referenced requests that were not already loaded, so "missing
  // request" findings reflect genuine absence — not operational-mode scoping.
  const loadedRequestIds = new Set(requests.docs.map((r) => r.id));
  const referencedRequestIds = new Set();
  for (const d of drivers.docs) {
    if (d.activeRequestId && !loadedRequestIds.has(d.activeRequestId)) {
      referencedRequestIds.add(d.activeRequestId);
    }
  }
  for (const b of batches.docs) {
    for (const rid of b.originalRequestIds ?? []) {
      if (!loadedRequestIds.has(rid)) referencedRequestIds.add(rid);
    }
  }

  // `maxRecords` is a bound on the TOTAL waterRequests documents this
  // diagnostic reads — the initially scanned page PLUS the referenced-request
  // backfill — not a per-phase cap. Resolve referenced ids only within the
  // budget the initial scan left. Ids beyond that budget are recorded as
  // `unresolvedRequestIds`: they were NOT read, so checks must treat them as
  // "not scanned", never as "missing" (see recovery-checks.mjs). Their presence
  // also truncates the waterRequests scan, so a clean result is never certified.
  const referenced = [...referencedRequestIds];
  const requestBudgetRemaining = Math.max(0, maxRecords - requests.docs.length);
  const idsToResolve = referenced.slice(0, requestBudgetRemaining);
  const unresolvedRequestIds = referenced.slice(requestBudgetRemaining);
  const backfillTruncated = unresolvedRequestIds.length > 0;

  const resolvedRequests = await reader.getByIds(
    "waterRequests",
    idsToResolve,
    REQUEST_FIELDS,
  );
  const allRequests = [...requests.docs, ...resolvedRequests];
  const requestsTruncated = requests.truncated || backfillTruncated;

  const truncated =
    drivers.truncated ||
    users.truncated ||
    batches.truncated ||
    requestsTruncated;

  const scanStatus = truncated
    ? "truncated"
    : fullScan
      ? "complete"
      : "operational";

  return {
    dataset: {
      drivers: drivers.docs,
      users: users.docs,
      batches: batches.docs,
      requests: allRequests,
      // Referenced request ids the budget prevented us from reading. Passed to
      // runIntegrityChecks so unread references never become false "missing".
      unresolvedRequestIds,
    },
    scan: {
      mode: fullScan ? "full-scan" : "operational",
      scanStatus,
      truncated,
      pageSize,
      maxRecords,
      counts: {
        drivers: drivers.docs.length,
        users: users.docs.length,
        batches: batches.docs.length,
        requestsScanned: requests.docs.length,
        requestsResolvedByReference: resolvedRequests.length,
        requestsUnresolvedByBudget: unresolvedRequestIds.length,
      },
      truncatedCollections: [
        drivers.truncated && "driverRegistry",
        users.truncated && "users",
        batches.truncated && "dispatchBatches",
        requestsTruncated && "waterRequests",
      ].filter(Boolean),
    },
  };
}

/**
 * Runs the full diagnostic: assemble the bounded dataset (the READ phase that
 * can fail on a bad target / permissions / unavailable database / read error),
 * then run the pure checks and compute the exit code. Read/target failures are
 * caught and mapped to a config/target/auth failure result (exit 2) so they can
 * never be mistaken for "no findings" (exit 0/3) or "findings" (exit 1), nor
 * crash out with an uncontrolled exit. The pure checks run only on a dataset
 * that assembled successfully.
 *
 * @param reader a `makeFirestoreReader` interface
 * @param runChecks the pure check runner (e.g. `runIntegrityChecks`)
 * @param {{ fullScan?: boolean, pageSize?: number, maxRecords?: number }} options
 * @returns {Promise<
 *   | { ok: true, dataset: Record<string, unknown>, scan: Record<string, unknown>, findings: unknown[], summary: Record<string, unknown>, exitCode: number }
 *   | { ok: false, exitCode: 2, failure: { phase: string, message: string } }
 * >} a discriminated result: `ok: true` carries the scan/findings/exitCode;
 *   `ok: false` carries `exitCode: 2` and a `failure` describing the read
 *   phase that could not complete.
 */
export async function runDiagnosticScan(reader, runChecks, options = {}) {
  let dataset;
  let scan;
  try {
    ({ dataset, scan } = await assembleDataset(reader, options));
  } catch (err) {
    return {
      ok: false,
      exitCode: 2,
      failure: {
        phase: "scan",
        // Message only — never the error object/stack or any credential value.
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const { findings, summary } = runChecks(dataset, {
    unresolvedRequestIds: dataset.unresolvedRequestIds ?? [],
  });
  const exitCode = computeExitCode(summary, scan);
  return { ok: true, dataset, scan, findings, summary, exitCode };
}

/**
 * Exit-code contract for the production diagnostic (documented in
 * docs/OPERATIONS.md):
 *   0 — intended scan completed without truncation AND no critical/warning findings
 *   1 — one or more critical/warning findings (any scan mode)
 *   2 — configuration/target/auth failure (handled by the CLI before scanning)
 *   3 — no critical/warning findings BUT the scan was truncated by a limit, so a
 *       clean result cannot be certified for the attempted scope
 *
 * `info`-severity findings never, on their own, make the exit code non-zero.
 */
export function computeExitCode(summary, scan) {
  const meaningful =
    (summary.bySeverity.critical ?? 0) + (summary.bySeverity.warning ?? 0);
  if (meaningful > 0) return 1;
  if (scan.truncated) return 3;
  return 0;
}
