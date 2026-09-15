import "server-only";

import { randomUUID } from "node:crypto";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getLogger, serializeError } from "@/lib/logging";

import {
  classifyMergeAuthError,
  decideAfterMergeAuthFailure,
  MERGE_AUTH_LEASE_DURATION_MS,
  MERGE_AUTH_WORKER_BATCH_LIMIT,
  type MergeAuthFailureCategory,
} from "./mergeReconciliationPolicy";

const log = getLogger("domain.merge-reconciliation");

const USERS_COLLECTION = "users";
export const MERGE_EVENTS_COLLECTION = "accountMergeEvents";

/**
 * Durable, resumable Firebase Auth reconciliation for committed account
 * merges (issue #73).
 *
 * The Firestore merge transaction is authoritative — it commits every
 * application state change atomically AND writes the `accountMergeEvents`
 * record with an `authReconciliation` sub-record already marked `pending`.
 * Firebase Auth cannot join a Firestore transaction, so making the
 * merged-away Auth identity safe is an honest at-least-once process:
 *
 *   1. IMMEDIATELY at commit time the transaction stamps
 *      `users/{duplicateUid}.mergedIntoUserId`. The application rejects that
 *      uid at both authentication boundaries (session creation and session
 *      verification) — so access is blocked from commit onward even if every
 *      Auth call below fails. That is the security invariant.
 *   2. The merge request then attempts reconciliation in-line (best effort —
 *      most merges finish here).
 *   3. Anything unresolved is durable and discovered by the hourly protected
 *      cron sweep, which retries with bounded backoff until `reconciled` or
 *      a terminal `failed` state an operator can inspect and manually retry.
 *
 * Per attempt the Auth sequence is: getUser → disable (if still enabled) →
 * revoke refresh tokens → delete. Disable is applied FIRST so a failure
 * leaves the identity disabled rather than active; revoke bounds the life of
 * already-issued credentials (session verification checks revocation);
 * `auth/user-not-found` anywhere is idempotent success.
 *
 * Concurrency: a Firestore lease transaction claims work (leaseOwner +
 * leaseExpiresAt); Auth calls run OUTSIDE any transaction; a second
 * lease-guarded transaction records the outcome. An expired lease (crashed
 * worker) is reclaimable; a newer worker's lease is never clobbered.
 */

// --- Auth operations seam ---------------------------------------------------

/**
 * Narrow Admin Auth surface this module needs. Injectable so tests can use
 * the Auth emulator directly or inject a precise failure (the emulator cannot
 * simulate e.g. a permission error); production always uses
 * {@link adminMergeAuthOps}.
 */
export interface MergeAuthOps {
  getUser(uid: string): Promise<{ disabled: boolean }>;
  disableUser(uid: string): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

export function adminMergeAuthOps(): MergeAuthOps {
  const auth = getAdminAuth();
  return {
    getUser: async (uid) => {
      const record = await auth.getUser(uid);
      return { disabled: record.disabled };
    },
    disableUser: (uid) =>
      auth.updateUser(uid, { disabled: true }).then(() => {}),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    deleteUser: (uid) => auth.deleteUser(uid),
  };
}

function isUserNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "auth/user-not-found";
}

// --- Firestore field helpers -------------------------------------------------

/**
 * The initial `authReconciliation` sub-record written INSIDE the merge
 * transaction — this is what makes the work durable from the moment the
 * merge commits. `nextAttemptAt` is the commit timestamp so the immediate
 * post-commit attempt is eligible at once.
 */
export function initialMergeAuthReconciliation(): Record<string, unknown> {
  return {
    state: "pending",
    attemptCount: 0,
    nextAttemptAt: FieldValue.serverTimestamp(),
    lastAttemptAt: null,
    lastFailureCategory: null,
    duplicateDisabled: false,
    reconciledAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}

function readRec(data: DocumentData): DocumentData | null {
  const rec = data.authReconciliation;
  return rec && typeof rec === "object" ? rec : null;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

// --- Claim (inside a transaction) -------------------------------------------

type ClaimResult =
  | { status: "claimed"; duplicateUserId: string; reclaimedStaleLease: boolean }
  | { status: "already_resolved" }
  | { status: "not_eligible" }
  | { status: "missing" }
  | { status: "invalid_record" };

/**
 * Transactionally claims one merge event for reconciliation. Eligibility:
 *  - `duplicateAuthDeleted !== true` is the unresolved discriminator and the
 *    only condition a caller needs for the candidate query.
 *  - missing `authReconciliation` (legacy record) → treated as due `pending`.
 *  - `pending` whose `nextAttemptAt` has passed.
 *  - `processing` whose lease has expired (crashed worker → reclamation).
 *  - `reconciled` while the deleted flag is still false → an inconsistent
 *    record that gets re-verified (self-healing; `user-not-found` then
 *    converges it safely).
 *  - `failed` is NEVER auto-claimed — only the manual retry path requeues it.
 *
 * The claim also backfills the `mergedIntoUserId` marker on the duplicate's
 * `users` doc for legacy merges that predate the marker — closing the
 * application-level gap for those records too.
 */
async function claimMergeAuthReconciliation(
  db: Firestore,
  ref: DocumentReference,
  leaseOwner: string,
  nowMs: number,
): Promise<ClaimResult> {
  return db.runTransaction(async (txn: Transaction) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { status: "missing" };
    const data = snap.data()!;

    if (data.duplicateAuthDeleted === true) {
      return { status: "already_resolved" };
    }

    const canonicalUserId = data.canonicalUserId;
    const duplicateUserId = data.duplicateUserId;
    const malformed =
      typeof canonicalUserId !== "string" ||
      canonicalUserId.length === 0 ||
      typeof duplicateUserId !== "string" ||
      duplicateUserId.length === 0 ||
      canonicalUserId === duplicateUserId;
    if (malformed) {
      const prior = readRec(data);
      txn.update(ref, {
        authReconciliation: {
          state: "failed",
          attemptCount:
            typeof prior?.attemptCount === "number" ? prior.attemptCount : 0,
          nextAttemptAt: null,
          lastAttemptAt: FieldValue.serverTimestamp(),
          lastFailureCategory: "invalid_record",
          duplicateDisabled: prior?.duplicateDisabled === true,
          reconciledAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
        error: "invalid_record",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: "invalid_record" };
    }

    const rec = readRec(data);
    const state: string | null = rec?.state ?? null;
    const nextAttemptMs = toMillis(rec?.nextAttemptAt);
    const leaseExpiresMs = toMillis(rec?.leaseExpiresAt);
    const reclaimedStaleLease =
      state === "processing" &&
      (leaseExpiresMs === null || leaseExpiresMs <= nowMs);
    const eligible =
      rec === null ||
      state === null ||
      (state === "pending" &&
        (nextAttemptMs === null || nextAttemptMs <= nowMs)) ||
      reclaimedStaleLease ||
      state === "reconciled"; // inconsistent record → re-verify
    if (!eligible) return { status: "not_eligible" };

    // Backfill the merged-away marker for legacy merges — read first, then
    // write, keeping Firestore's all-reads-before-writes rule inside the txn.
    const duplicateUserRef = db
      .collection(USERS_COLLECTION)
      .doc(duplicateUserId);
    const duplicateUserSnap = await txn.get(duplicateUserRef);

    txn.update(ref, {
      authReconciliation: {
        state: "processing",
        attemptCount:
          typeof rec?.attemptCount === "number" ? rec.attemptCount : 0,
        nextAttemptAt: rec?.nextAttemptAt ?? null,
        lastAttemptAt: rec?.lastAttemptAt ?? null,
        lastFailureCategory: rec?.lastFailureCategory ?? null,
        duplicateDisabled: rec?.duplicateDisabled === true,
        reconciledAt: rec?.reconciledAt ?? null,
        leaseOwner,
        leaseExpiresAt: Timestamp.fromMillis(
          nowMs + MERGE_AUTH_LEASE_DURATION_MS,
        ),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (
      duplicateUserSnap.exists &&
      !duplicateUserSnap.data()!.mergedIntoUserId
    ) {
      txn.update(duplicateUserRef, {
        mergedIntoUserId: canonicalUserId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { status: "claimed", duplicateUserId, reclaimedStaleLease };
  });
}

// --- Act (outside any transaction) ------------------------------------------

type AuthAttemptOutcome =
  | { status: "reconciled"; duplicateDisabled: boolean }
  | {
      status: "failed";
      category: MergeAuthFailureCategory;
      duplicateDisabled: boolean;
    };

/**
 * Performs the Auth-side convergence for the recorded merged-away uid.
 * Never throws — every failure is classified. Only the duplicate uid is ever
 * touched; the canonical/survivor uid is never passed to any Auth operation.
 */
async function performMergeAuthReconciliation(
  ops: MergeAuthOps,
  duplicateUserId: string,
): Promise<AuthAttemptOutcome> {
  let user: { disabled: boolean };
  try {
    user = await ops.getUser(duplicateUserId);
  } catch (error) {
    if (isUserNotFound(error)) {
      // Already deleted (or never created) — the goal state. This also covers
      // the crash window where deletion succeeded but the outcome write did
      // not: the next attempt converges here.
      return { status: "reconciled", duplicateDisabled: false };
    }
    return {
      status: "failed",
      category: classifyMergeAuthError(error),
      duplicateDisabled: false,
    };
  }

  // Disable FIRST so a delete failure (or crash before delete) leaves the
  // identity unable to authenticate rather than fully active. Idempotent: an
  // already-disabled user is left alone.
  let duplicateDisabled = user.disabled;
  if (!duplicateDisabled) {
    try {
      await ops.disableUser(duplicateUserId);
      duplicateDisabled = true;
    } catch {
      // Non-fatal: delete is still attempted below, and the durable
      // application-level rejection marker blocks access regardless.
    }
  }

  // Revoke refresh tokens so already-issued credentials are rejected at the
  // next revocation-checked verification (this app always verifies session
  // cookies with checkRevoked=true). Non-fatal: delete subsumes it, and the
  // marker still blocks application access.
  try {
    await ops.revokeRefreshTokens(duplicateUserId);
  } catch {
    // Non-fatal — see above.
  }

  try {
    await ops.deleteUser(duplicateUserId);
    return { status: "reconciled", duplicateDisabled };
  } catch (error) {
    if (isUserNotFound(error)) {
      return { status: "reconciled", duplicateDisabled };
    }
    return {
      status: "failed",
      category: classifyMergeAuthError(error),
      duplicateDisabled,
    };
  }
}

// --- Record (inside a lease-guarded transaction) -----------------------------

type RecordResult = "reconciled" | "retry_scheduled" | "failed" | "skipped";

async function recordMergeAuthOutcome(
  db: Firestore,
  ref: DocumentReference,
  leaseOwner: string,
  outcome: AuthAttemptOutcome,
  nowMs: number,
  rng: () => number,
): Promise<RecordResult> {
  return db.runTransaction(async (txn: Transaction) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return "skipped";
    const data = snap.data()!;
    const rec = readRec(data);
    if (rec?.state !== "processing" || rec?.leaseOwner !== leaseOwner) {
      // A newer worker owns the record (or it was manually resolved) — never
      // clobber its state. Our Auth-side effects are idempotent, so the new
      // owner re-doing them is safe.
      return "skipped";
    }

    const attemptCount =
      (typeof rec.attemptCount === "number" ? rec.attemptCount : 0) + 1;
    const base = {
      attemptCount,
      lastAttemptAt: FieldValue.serverTimestamp(),
      lastFailureCategory: rec.lastFailureCategory ?? null,
      duplicateDisabled: outcome.duplicateDisabled,
      reconciledAt: rec.reconciledAt ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
    };

    if (outcome.status === "reconciled") {
      txn.update(ref, {
        authReconciliation: {
          ...base,
          state: "reconciled",
          nextAttemptAt: null,
          lastFailureCategory: null,
          reconciledAt: FieldValue.serverTimestamp(),
        },
        duplicateAuthDeleted: true,
        error: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return "reconciled";
    }

    const decision = decideAfterMergeAuthFailure(
      attemptCount,
      outcome.category,
      rng,
    );
    txn.update(ref, {
      authReconciliation: {
        ...base,
        state: decision.state,
        nextAttemptAt:
          decision.retryDelayMs !== undefined
            ? Timestamp.fromMillis(nowMs + decision.retryDelayMs)
            : null,
        lastFailureCategory: decision.category,
      },
      duplicateAuthDeleted: false,
      error: decision.category,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return decision.state === "pending" ? "retry_scheduled" : "failed";
  });
}

// --- Public API ---------------------------------------------------------------

export type MergeReconcileOutcome =
  | { status: "reconciled"; duplicateDisabled: boolean }
  | {
      status: "retry_scheduled";
      category: MergeAuthFailureCategory;
      duplicateDisabled: boolean;
    }
  | {
      status: "failed";
      category: MergeAuthFailureCategory;
      duplicateDisabled: boolean;
    }
  /** Not eligible right now (active lease, not yet due, or record missing). */
  | { status: "skipped" }
  /** Already resolved — nothing to do. */
  | { status: "already_resolved" }
  /** Malformed record — marked terminally failed, no Auth calls made. */
  | { status: "invalid_record" }
  /** Local infrastructure failure (claim/outcome transaction threw). The
   *  lease expires and a later attempt converges; never unsafe. */
  | { status: "error" };

export interface ReconcileMergeAuthOptions {
  /** Epoch ms treated as "now" (injected for deterministic tests). */
  now?: number;
  /** Lease owner id (default: a fresh random id per call). */
  leaseOwner?: string;
  /** Injected Auth operations (default: the real Admin SDK). */
  auth?: MergeAuthOps;
  /** Injected RNG for backoff jitter (default `Math.random`). */
  rng?: () => number;
}

/**
 * Runs one full claim → act → record cycle for a single merge event. Called
 * immediately after a merge commits (best effort) and by the sweep/manual
 * retry for anything still unresolved. Safe to call repeatedly and
 * concurrently.
 */
export async function reconcileMergeAuthEvent(
  eventId: string,
  options: ReconcileMergeAuthOptions = {},
): Promise<MergeReconcileOutcome> {
  const db = getAdminDb();
  const ref = db.collection(MERGE_EVENTS_COLLECTION).doc(eventId);
  const nowMs = options.now ?? Date.now();
  const leaseOwner = options.leaseOwner ?? randomUUID();
  const rng = options.rng ?? Math.random;

  let claim: ClaimResult;
  try {
    claim = await claimMergeAuthReconciliation(db, ref, leaseOwner, nowMs);
  } catch (error) {
    log.error("merge.auth_reconciliation.claim_failed", {
      eventId,
      error: serializeError(error),
    });
    return { status: "error" };
  }

  switch (claim.status) {
    case "missing":
    case "not_eligible":
      return { status: "skipped" };
    case "already_resolved":
      return { status: "already_resolved" };
    case "invalid_record":
      log.error("merge.auth_reconciliation.invalid_record", { eventId });
      return { status: "invalid_record" };
    case "claimed":
      break;
  }

  if (claim.reclaimedStaleLease) {
    log.warn("merge.auth_reconciliation.stale_lease_reclaimed", { eventId });
  }

  let ops: MergeAuthOps;
  try {
    ops = options.auth ?? adminMergeAuthOps();
  } catch (error) {
    ops = {
      getUser: () => Promise.reject(error),
      disableUser: () => Promise.reject(error),
      revokeRefreshTokens: () => Promise.reject(error),
      deleteUser: () => Promise.reject(error),
    };
  }
  const outcome = await performMergeAuthReconciliation(
    ops,
    claim.duplicateUserId,
  );

  let recorded: RecordResult;
  try {
    recorded = await recordMergeAuthOutcome(
      db,
      ref,
      leaseOwner,
      outcome,
      nowMs,
      rng,
    );
  } catch (error) {
    log.error("merge.auth_reconciliation.outcome_write_failed", {
      eventId,
      error: serializeError(error),
    });
    // The lease stays until expiry; the next attempt re-runs the idempotent
    // Auth sequence and converges on `user-not-found` if deletion landed.
    return { status: "error" };
  }

  if (recorded === "skipped") return { status: "skipped" };
  if (recorded === "reconciled") {
    log.info("merge.auth_reconciliation.reconciled", { eventId });
    return {
      status: "reconciled",
      duplicateDisabled: outcome.duplicateDisabled,
    };
  }
  const category = outcome.status === "failed" ? outcome.category : "transient";
  if (recorded === "retry_scheduled") {
    log.info("merge.auth_reconciliation.retry_scheduled", {
      eventId,
      category,
    });
    return {
      status: "retry_scheduled",
      category,
      duplicateDisabled: outcome.duplicateDisabled,
    };
  }
  log.error("merge.auth_reconciliation.terminal_failure", {
    eventId,
    category,
  });
  return {
    status: "failed",
    category,
    duplicateDisabled: outcome.duplicateDisabled,
  };
}

export interface ProcessMergeAuthReconciliationOptions extends ReconcileMergeAuthOptions {
  /** Max merge events attempted this pass (default worker batch limit). */
  limit?: number;
}

export interface ProcessMergeAuthReconciliationResult {
  scanned: number;
  claimed: number;
  reconciled: number;
  retried: number;
  terminal: number;
  skipped: number;
  errors: number;
}

/**
 * Bounded sweep: finds every merge event whose duplicate Auth cleanup is
 * unresolved (`duplicateAuthDeleted !== true` — which also catches legacy
 * records created before `authReconciliation` existed) in deterministic
 * createdAt order, and runs the claim → act → record cycle on each. Safe at
 * any cadence and safe under concurrency — leases arbitrate.
 */
export async function processMergeAuthReconciliation(
  options: ProcessMergeAuthReconciliationOptions = {},
): Promise<ProcessMergeAuthReconciliationResult> {
  const db = getAdminDb();
  const nowMs = options.now ?? Date.now();
  const limit = options.limit ?? MERGE_AUTH_WORKER_BATCH_LIMIT;
  const leaseOwner = options.leaseOwner ?? randomUUID();
  const rng = options.rng ?? Math.random;

  const snapshot = await db
    .collection(MERGE_EVENTS_COLLECTION)
    .where("duplicateAuthDeleted", "==", false)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  const result: ProcessMergeAuthReconciliationResult = {
    scanned: snapshot.size,
    claimed: 0,
    reconciled: 0,
    retried: 0,
    terminal: 0,
    skipped: 0,
    errors: 0,
  };

  for (const doc of snapshot.docs) {
    const outcome = await reconcileMergeAuthEvent(doc.id, {
      now: nowMs,
      leaseOwner,
      rng,
      ...(options.auth ? { auth: options.auth } : {}),
    });
    switch (outcome.status) {
      case "reconciled":
        result.claimed++;
        result.reconciled++;
        break;
      case "retry_scheduled":
        result.claimed++;
        result.retried++;
        break;
      case "failed":
      case "invalid_record":
        result.claimed++;
        result.terminal++;
        break;
      case "error":
        result.errors++;
        break;
      default:
        result.skipped++;
        break;
    }
  }

  // Aggregate counts only — never uids or provider payloads.
  log.info("merge.auth_reconciliation.processed", { ...result });
  return result;
}

// --- Admin/operator surface ---------------------------------------------------

export interface MergeReconciliationOverview {
  /** State `pending` and due-or-scheduled (includes legacy records counted
   *  via the unresolved query). */
  pending: number;
  /** State `processing` with an unexpired lease. */
  processing: number;
  /** State `processing` whose lease has expired — abandoned work that the
   *  sweep will reclaim. */
  staleProcessing: number;
  /** State `failed` — terminal for automatic retry; needs an operator. */
  failed: number;
  /** Total unresolved (`duplicateAuthDeleted !== true`) across all states —
   *  includes legacy records that have no `authReconciliation` yet. */
  unresolved: number;
}

export async function getMergeReconciliationOverview(
  nowMs: number = Date.now(),
): Promise<MergeReconciliationOverview> {
  const db = getAdminDb();
  const col = db.collection(MERGE_EVENTS_COLLECTION);

  const [unresolved, pending, processing, staleProcessing, failed] =
    await Promise.all([
      col.where("duplicateAuthDeleted", "==", false).count().get(),
      col.where("authReconciliation.state", "==", "pending").count().get(),
      col
        .where("authReconciliation.state", "==", "processing")
        .where(
          "authReconciliation.leaseExpiresAt",
          ">",
          Timestamp.fromMillis(nowMs),
        )
        .count()
        .get(),
      col
        .where("authReconciliation.state", "==", "processing")
        .where(
          "authReconciliation.leaseExpiresAt",
          "<=",
          Timestamp.fromMillis(nowMs),
        )
        .count()
        .get(),
      col.where("authReconciliation.state", "==", "failed").count().get(),
    ]);

  return {
    pending: pending.data().count,
    processing: processing.data().count,
    staleProcessing: staleProcessing.data().count,
    failed: failed.data().count,
    unresolved: unresolved.data().count,
  };
}

export interface MergeReconciliationEntry {
  eventId: string;
  canonicalUserId: string;
  duplicateUserId: string;
  createdAt: string;
  state: string;
  attemptCount: number;
  lastFailureCategory: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  duplicateDisabled: boolean;
}

/** Sanitized list of unresolved reconciliations for the admin merge tool. */
export async function listUnresolvedMergeReconciliations(
  limit = 50,
): Promise<MergeReconciliationEntry[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(MERGE_EVENTS_COLLECTION)
    .where("duplicateAuthDeleted", "==", false)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const rec = readRec(data);
    return {
      eventId: doc.id,
      canonicalUserId: String(data.canonicalUserId ?? ""),
      duplicateUserId: String(data.duplicateUserId ?? ""),
      createdAt:
        data.createdAt?.toDate?.()?.toISOString?.() ??
        String(data.createdAt ?? ""),
      state: rec?.state ?? "pending",
      attemptCount:
        typeof rec?.attemptCount === "number" ? rec.attemptCount : 0,
      lastFailureCategory: rec?.lastFailureCategory ?? data.error ?? null,
      lastAttemptAt: rec?.lastAttemptAt?.toDate?.()?.toISOString?.() ?? null,
      nextAttemptAt: rec?.nextAttemptAt?.toDate?.()?.toISOString?.() ?? null,
      leaseExpiresAt: rec?.leaseExpiresAt?.toDate?.()?.toISOString?.() ?? null,
      duplicateDisabled: rec?.duplicateDisabled === true,
    };
  });
}

export type MergeReconciliationRetryResult =
  | { status: "not_found" }
  | { status: "already_reconciled" }
  | { status: "in_progress" }
  | { status: "attempted"; outcome: MergeReconcileOutcome };

/**
 * Server-authoritative manual retry (admin only — callers enforce the role).
 * Idempotent: refuses reconciled records and active leases, never reopens the
 * Firestore merge, and only ever targets the recorded duplicate uid. A
 * requeued record is attempted immediately so the operator gets feedback in
 * the same request.
 */
export async function retryMergeReconciliation(
  eventId: string,
  options: ReconcileMergeAuthOptions = {},
): Promise<MergeReconciliationRetryResult> {
  const db = getAdminDb();
  const ref = db.collection(MERGE_EVENTS_COLLECTION).doc(eventId);
  const nowMs = options.now ?? Date.now();

  const requeue = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { status: "not_found" as const };
    const data = snap.data()!;
    if (data.duplicateAuthDeleted === true) {
      return { status: "already_reconciled" as const };
    }
    const rec = readRec(data);
    const leaseExpiresMs = toMillis(rec?.leaseExpiresAt);
    if (
      rec?.state === "processing" &&
      leaseExpiresMs !== null &&
      leaseExpiresMs > nowMs
    ) {
      return { status: "in_progress" as const };
    }
    // Requeue pending-with-fresh-budget; an expired processing lease (dead
    // worker) is treated the same way.
    txn.update(ref, {
      authReconciliation: {
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: Timestamp.fromMillis(nowMs),
        lastAttemptAt: rec?.lastAttemptAt ?? null,
        lastFailureCategory: rec?.lastFailureCategory ?? null,
        duplicateDisabled: rec?.duplicateDisabled === true,
        reconciledAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "requeued" as const };
  });

  if (requeue.status !== "requeued") {
    return requeue;
  }

  const outcome = await reconcileMergeAuthEvent(eventId, {
    ...options,
    leaseOwner: options.leaseOwner ?? `admin-retry:${randomUUID()}`,
  });
  return { status: "attempted", outcome };
}
