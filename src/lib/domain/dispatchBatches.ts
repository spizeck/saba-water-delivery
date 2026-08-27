import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import {
  type BatchCandidateSnapshot,
  type BatchValidationIssue,
  type DeliveryRunDerivedState,
  deriveRunState,
  validateBatchSelection,
} from "./dispatchBatchSelection";
import type { DispatchBatch, DispatchBatchStatus, WaterRequestStatus } from "./types";
import { getRequestsForDispatchBatch } from "./waterRequests";

/**
 * Server-side orchestration for Batch Dispatch — see PRODUCT.md /
 * TECHNICAL.md "Batch Dispatch". This is a deliberate,
 * dispatcher-controlled EXCEPTION to the normal one-offer-at-a-time
 * driver dispatch workflow (`dispatch.ts`), used when staff need to
 * preassign several loads to one driver at once and hand them a
 * printable run sheet — e.g. for a driver whose phone/data access is
 * unreliable. It never weakens the normal self-claim invariant; see
 * "Interaction with activeRequestId" below.
 *
 * Selection/validation rules live in the pure `dispatchBatchSelection.ts`
 * module so they can be unit tested without Firestore.
 */

const BATCHES_COLLECTION = "dispatchBatches";
const REQUESTS_COLLECTION = "waterRequests";
const REGISTRY_COLLECTION = "driverRegistry";

function toDispatchBatch(id: string, data: DocumentData): DispatchBatch {
  return {
    id,
    driverId: data.driverId,
    driverDisplayName: (data.driverDisplayName as string) ?? null,
    createdBy: data.createdBy,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    status: (data.status as DispatchBatchStatus) ?? "active",
    originalRequestIds: Array.isArray(data.originalRequestIds) ? data.originalRequestIds : [],
    generatedAt: data.generatedAt?.toDate?.().toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  };
}

/**
 * A single, specific validation failure, thrown as an `Error` whose
 * `message` is `"<ISSUE_CODE>"` or `"<ISSUE_CODE>:<requestId>"` so
 * callers can map it to a clear message without needing a custom error
 * class, consistent with the rest of the domain layer's error
 * conventions (see e.g. `waterRequests.ts`).
 */
function batchIssueToError(issue: BatchValidationIssue): Error {
  switch (issue.code) {
    case "NO_REQUESTS_SELECTED":
    case "TOO_MANY_REQUESTS":
      return new Error(issue.code);
    case "DUPLICATE_REQUEST_ID":
    case "REQUEST_NOT_FOUND":
    case "REQUEST_NOT_ELIGIBLE":
    case "PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED":
      return new Error(`${issue.code}:${issue.requestId}`);
  }
}

export interface CreateDispatchBatchInput {
  /** Firebase uid of the linked driver account (never the driverRegistry
   * document ID — see TECHNICAL.md "Canonical Driver ID"). */
  driverId: string;
  /** Request IDs in the desired run-sheet order. */
  requestIds: string[];
  /** uid of the dispatcher/admin creating the batch. */
  actorId: string;
  /**
   * Request IDs the dispatcher explicitly reviewed and confirmed they
   * want to override a DIFFERENT resident's preferred-driver hold for.
   * A hold addressed to the SAME driver the batch is being assigned to
   * is never an override and never needs acknowledgment. See
   * PRODUCT.md "Batch Dispatch" "Preferred-driver overrides".
   */
  acknowledgedPreferredOverrideRequestIds?: string[];
}

/**
 * Atomically assigns a set of eligible requests to one driver as a new
 * dispatch batch. All-or-nothing: every request is re-validated against
 * its LIVE Firestore state inside the transaction (never trusting
 * whatever the dispatcher's review screen last saw), so if any selected
 * request changed state while the dispatcher was reviewing — claimed by
 * someone else, cancelled, etc. — the entire transaction aborts and
 * NOTHING is assigned; the caller must re-review and retry (see
 * TECHNICAL.md "Batch Dispatch" "Atomic Assignment").
 *
 * Deliberately does NOT touch `driverRegistry.activeRequestId` — see
 * TECHNICAL.md "Batch Dispatch" "Interaction with activeRequestId" for
 * why the existing defensive fallback checks in `claimWaterRequest()` /
 * `dispatcherAssign()` / `dispatcherReassign()` (which query for ANY
 * `"claimed"` request assigned to a driver when `activeRequestId` is
 * unset) already correctly block further self-claims or single
 * dispatcher assignments once a driver holds batch-assigned work,
 * without any change to those functions.
 */
export async function createDispatchBatch(
  input: CreateDispatchBatchInput,
): Promise<{ batch: DispatchBatch; requests: Awaited<ReturnType<typeof getRequestsForDispatchBatch>> }> {
  const { driverId, requestIds, actorId } = input;
  const acknowledged = new Set(input.acknowledgedPreferredOverrideRequestIds ?? []);
  const db = getAdminDb();
  const batchRef = db.collection(BATCHES_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    // ---- All reads first ----
    const driverSnap = await txn.get(
      db.collection(REGISTRY_COLLECTION).where("linkedUserId", "==", driverId).limit(1),
    );
    if (driverSnap.empty) throw new Error("DRIVER_NOT_FOUND");
    const driverData = driverSnap.docs[0].data();
    if (driverData.eligibilityStatus !== "eligible") throw new Error("DRIVER_INELIGIBLE");
    const driverDisplayName = (driverData.displayName as string) || "Unknown driver";

    const requestRefs = requestIds.map((id) => db.collection(REQUESTS_COLLECTION).doc(id));
    const requestSnaps = await Promise.all(requestRefs.map((ref) => txn.get(ref)));

    const snapshots: BatchCandidateSnapshot[] = requestSnaps.map((snap, i) => ({
      id: requestIds[i],
      exists: snap.exists,
      status: snap.exists ? ((snap.data()!.status as WaterRequestStatus) ?? null) : null,
      assignedDriverId: snap.exists ? (snap.data()!.assignedDriverId ?? null) : null,
      preferredDriverId: snap.exists ? (snap.data()!.preferredDriverId ?? null) : null,
    }));

    const issues = validateBatchSelection(requestIds, snapshots, driverId, acknowledged);
    if (issues.length > 0) throw batchIssueToError(issues[0]);

    // ---- All writes after reads (atomic: this transaction either
    // fully commits every write below, or none of them) ----
    txn.set(batchRef, {
      driverId,
      driverDisplayName,
      createdBy: actorId,
      createdAt: now,
      status: "active",
      originalRequestIds: requestIds,
      generatedAt: null,
      updatedAt: now,
    });

    const batchEventRef = batchRef.collection("events").doc();
    txn.set(batchEventRef, {
      type: "dispatch_batch_created",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { driverId, requestIds, count: requestIds.length },
    });

    requestIds.forEach((id, index) => {
      const ref = requestRefs[index];
      const reqData = requestSnaps[index].data()!;
      const sequence = index + 1;
      const overriddenPreferredDriverId =
        reqData.status === "preferred_driver_hold" &&
        reqData.preferredDriverId &&
        reqData.preferredDriverId !== driverId
          ? (reqData.preferredDriverId as string)
          : null;

      txn.update(ref, {
        assignedDriverId: driverId,
        status: "claimed",
        claimedAt: now,
        dispatchBatchId: batchRef.id,
        batchSequence: sequence,
        updatedAt: now,
      });

      const eventRef = ref.collection("events").doc();
      txn.set(eventRef, {
        type: "dispatcher_batch_assigned",
        actorId,
        actorRole: "dispatcher",
        createdAt: now,
        metadata: {
          dispatchBatchId: batchRef.id,
          driverId,
          sequence,
          ...(overriddenPreferredDriverId ? { overriddenPreferredDriverId } : {}),
        },
      });
    });
  });

  const [batchDoc, requests] = await Promise.all([
    batchRef.get(),
    getRequestsForDispatchBatch(batchRef.id),
  ]);
  return { batch: toDispatchBatch(batchRef.id, batchDoc.data()!), requests };
}

export async function getDispatchBatch(batchId: string): Promise<DispatchBatch | null> {
  const db = getAdminDb();
  const doc = await db.collection(BATCHES_COLLECTION).doc(batchId).get();
  if (!doc.exists) return null;
  return toDispatchBatch(doc.id, doc.data()!);
}

/**
 * Returns batches most-recently-created first, bounded to a reasonable
 * page size — this is an operational list for staff, not a paginated
 * archive (see DEVIN.md "Do Not Overbuild"). A single `orderBy` on
 * `createdAt` needs no composite index.
 */
export async function getAllDispatchBatches(limitCount = 50): Promise<DispatchBatch[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(BATCHES_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();
  return snapshot.docs.map((doc) => toDispatchBatch(doc.id, doc.data()));
}

/** Enriched batch summary with live progress derived from member requests. */
export interface DispatchBatchSummary extends DispatchBatch {
  /** Driver display name — from snapshot if available, else from live
   * registry lookup, else "Unknown driver". */
  resolvedDriverName: string;
  /** Total requests currently belonging to this batch. */
  currentRequestCount: number;
  /** Total physical loads across all current members. */
  totalLoads: number;
  /** Physical loads whose request status has left "claimed" (delivered,
   * confirmed, disputed — NOT cancelled/reassigned-out, which are no
   * longer members). */
  loadsDelivered: number;
  /** Derived operational state — see `DeliveryRunDerivedState`. */
  derivedState: DeliveryRunDerivedState;
}

/**
 * Returns enriched batch summaries with live progress, resolving
 * driver names from snapshots first and falling back to the registry.
 */
export async function getAllDispatchBatchSummaries(
  driverNames: Record<string, string>,
  limitCount = 50,
): Promise<DispatchBatchSummary[]> {
  const batches = await getAllDispatchBatches(limitCount);
  if (batches.length === 0) return [];

  const db = getAdminDb();

  // Fetch all current members for each batch in parallel.
  const membersByBatch = await Promise.all(
    batches.map(async (batch) => {
      const snap = await db
        .collection("waterRequests")
        .where("dispatchBatchId", "==", batch.id)
        .get();
      return {
        batchId: batch.id,
        members: snap.docs.map((d) => ({
          loads: (d.data().loads as number) ?? 1,
          status: (d.data().status as string) ?? "cancelled",
        })),
      };
    }),
  );

  const memberMap = new Map(membersByBatch.map((m) => [m.batchId, m.members]));

  return batches.map((batch) => {
    const members = memberMap.get(batch.id) ?? [];
    const { derivedState, totalLoads, loadsDelivered } = deriveRunState(members);

    const resolvedDriverName =
      batch.driverDisplayName || driverNames[batch.driverId] || "Unknown driver";

    return {
      ...batch,
      resolvedDriverName,
      currentRequestCount: members.length,
      totalLoads,
      loadsDelivered,
      derivedState,
    };
  });
}

export interface DispatchBatchEventRecord {
  id: string;
  type: string;
  actorId: string | null;
  actorRole: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export async function getDispatchBatchEvents(batchId: string): Promise<DispatchBatchEventRecord[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(BATCHES_COLLECTION)
    .doc(batchId)
    .collection("events")
    .orderBy("createdAt", "asc")
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type,
      actorId: data.actorId ?? null,
      actorRole: data.actorRole ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
      metadata: data.metadata ?? null,
    };
  });
}

/**
 * Records that a run sheet was generated or reprinted for this batch.
 * Never creates a new batch merely because the PDF needs regenerating —
 * see PRODUCT.md "Batch Dispatch" "Reprint".
 */
export async function recordBatchGenerated(batchId: string, actorId: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection(BATCHES_COLLECTION).doc(batchId);
  const now = FieldValue.serverTimestamp();

  await ref.update({ generatedAt: now, updatedAt: now });
  await ref.collection("events").add({
    type: "dispatch_batch_reprinted",
    actorId,
    actorRole: "dispatcher",
    createdAt: now,
    metadata: null,
  });
}

/**
 * Staff-only close/cancel for a delivery run that no longer has any
 * outstanding claimed requests — e.g. orphaned prelaunch data or a run
 * whose requests were all individually reassigned/cancelled. Forces
 * the batch status to "completed" so it no longer appears as active.
 *
 * Does NOT touch individual requests — it only updates the batch
 * document status. If any request is still "claimed" in this batch,
 * the operation is refused to avoid hiding genuinely active work.
 */
export async function closeDeliveryRun(
  batchId: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getAdminDb();
  const batchRef = db.collection(BATCHES_COLLECTION).doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) return { ok: false, reason: "BATCH_NOT_FOUND" };

  const data = batchSnap.data()!;
  if (data.status === "completed") return { ok: true };

  // Check that no member is still "claimed".
  const membersSnap = await db
    .collection(REQUESTS_COLLECTION)
    .where("dispatchBatchId", "==", batchId)
    .get();
  const claimedMembers = membersSnap.docs.filter(
    (d) => d.data().status === "claimed",
  );
  if (claimedMembers.length > 0) {
    return {
      ok: false,
      reason: `Cannot close: ${claimedMembers.length} request(s) still claimed. Reassign or cancel them individually first.`,
    };
  }

  const now = FieldValue.serverTimestamp();
  await batchRef.update({ status: "completed", updatedAt: now });
  await batchRef.collection("events").add({
    type: "dispatch_batch_closed",
    actorId,
    actorRole: "dispatcher",
    createdAt: now,
    metadata: { reason: "manual_close" },
  });

  return { ok: true };
}
