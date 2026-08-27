/**
 * Pure selection/validation logic for Batch Dispatch — deliberately
 * factored out of `dispatchBatches.ts` (which has Firestore/`server-only`
 * dependencies) so it can be unit tested directly, same pattern as
 * `dispatchSelection.ts` for `dispatch.ts`. See PRODUCT.md / TECHNICAL.md
 * "Batch Dispatch".
 */

import { priorityRankFor } from "./priority";
import type { DispatchBatchStatus, WaterRequest, WaterRequestStatus } from "./types";

/**
 * Conservative technical safety bound on how many requests a single
 * batch may contain. This is NOT a business/product policy limit —
 * there is no operational reason to cap batches at a specific number —
 * it exists purely so a single batch-creation Firestore transaction
 * stays comfortably within Firestore's ~500-mutation-per-transaction
 * limit (each request costs two writes: the request update and its
 * audit event) and so the review screen remains usable on a phone.
 * Raise this only if a real operational need appears.
 */
export const MAX_BATCH_SIZE = 25;

/** Requests eligible to be added to a batch — see PRODUCT.md "Batch
 * Dispatch": still waiting for a driver to physically deliver them. */
export const BATCH_ELIGIBLE_STATUSES: WaterRequestStatus[] = [
  "available",
  "preferred_driver_hold",
];

/**
 * Default operational ordering for the batch-selection list: highest
 * dispatch priority first, oldest request first within the same
 * priority — identical convention to normal single-driver dispatch
 * (`dispatchSelection.ts`) and the continuity report. The dispatcher
 * may still deliberately select a different subset, but the list
 * itself must never default to an arbitrary or alphabetical order.
 */
/**
 * Sort key for the dispatch queue. Lower `dispatchOverrideRank` values
 * sort ahead of higher ones (and ahead of nulls) within the same
 * dispatch priority, while `requestedAt` is never modified. This is
 * the same ordering used by `getNextOfferForDriver` so batch selection
 * and normal dispatch stay aligned.
 */
export function dispatchQueueCompare(a: WaterRequest, b: WaterRequest): number {
  const rankDiff = priorityRankFor(a.dispatchPriority) - priorityRankFor(b.dispatchPriority);
  if (rankDiff !== 0) return rankDiff;
  const overrideA = a.dispatchOverrideRank ?? Infinity;
  const overrideB = b.dispatchOverrideRank ?? Infinity;
  if (overrideA !== overrideB) return overrideA - overrideB;
  return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
}

export function sortForBatchSelection(requests: WaterRequest[]): WaterRequest[] {
  return [...requests].sort(dispatchQueueCompare);
}

/**
 * A minimal snapshot of a candidate request's Firestore fields, used
 * both by the live transaction (built from fresh reads) and by unit
 * tests (built directly) so the same validation function guarantees
 * the same outcome in both places.
 */
export interface BatchCandidateSnapshot {
  id: string;
  exists: boolean;
  status: WaterRequestStatus | null;
  assignedDriverId: string | null;
  preferredDriverId: string | null;
}

export type BatchValidationIssue =
  | { code: "NO_REQUESTS_SELECTED" }
  | { code: "TOO_MANY_REQUESTS"; limit: number }
  | { code: "DUPLICATE_REQUEST_ID"; requestId: string }
  | { code: "REQUEST_NOT_FOUND"; requestId: string }
  | { code: "REQUEST_NOT_ELIGIBLE"; requestId: string; status: WaterRequestStatus }
  | { code: "PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED"; requestId: string; preferredDriverId: string };

/**
 * Validates a proposed batch against fresh (or test-fixture) request
 * snapshots. Returns every issue found — not just the first — so a
 * dispatcher/caller can present a complete picture, though in practice
 * `createDispatchBatch()` treats ANY issue as a reason to abort the
 * whole transaction atomically (see TECHNICAL.md "Batch Dispatch" /
 * "Atomic Assignment").
 *
 * `acknowledgedPreferredOverrideRequestIds` is the set of request IDs
 * the dispatcher explicitly reviewed and confirmed they want to
 * override a DIFFERENT resident's preferred-driver hold for — see
 * PRODUCT.md "Batch Dispatch" "Preferred-driver overrides". A
 * preferred-driver hold addressed to the SAME driver the batch is
 * being assigned to is never an override and never needs
 * acknowledgment.
 */
export function validateBatchSelection(
  requestIds: string[],
  snapshots: BatchCandidateSnapshot[],
  driverId: string,
  acknowledgedPreferredOverrideRequestIds: ReadonlySet<string>,
): BatchValidationIssue[] {
  const issues: BatchValidationIssue[] = [];

  if (requestIds.length === 0) {
    issues.push({ code: "NO_REQUESTS_SELECTED" });
    return issues;
  }
  if (requestIds.length > MAX_BATCH_SIZE) {
    issues.push({ code: "TOO_MANY_REQUESTS", limit: MAX_BATCH_SIZE });
  }

  const seen = new Set<string>();
  for (const id of requestIds) {
    if (seen.has(id)) {
      issues.push({ code: "DUPLICATE_REQUEST_ID", requestId: id });
    }
    seen.add(id);
  }

  const byId = new Map(snapshots.map((s) => [s.id, s]));
  for (const id of requestIds) {
    const snap = byId.get(id);
    if (!snap || !snap.exists) {
      issues.push({ code: "REQUEST_NOT_FOUND", requestId: id });
      continue;
    }
    // Already assigned to a driver (self-claimed, singly assigned, or
    // already part of a batch) — no longer eligible regardless of its
    // stored status string.
    if (snap.assignedDriverId || !snap.status || !BATCH_ELIGIBLE_STATUSES.includes(snap.status)) {
      issues.push({
        code: "REQUEST_NOT_ELIGIBLE",
        requestId: id,
        status: snap.status ?? "cancelled",
      });
      continue;
    }
    if (
      snap.status === "preferred_driver_hold" &&
      snap.preferredDriverId &&
      snap.preferredDriverId !== driverId &&
      !acknowledgedPreferredOverrideRequestIds.has(id)
    ) {
      issues.push({
        code: "PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED",
        requestId: id,
        preferredDriverId: snap.preferredDriverId,
      });
    }
  }

  return issues;
}

/**
 * Derives a batch's current operational status from its member
 * requests' CURRENT statuses (see `DispatchBatchStatus` in types.ts).
 * Pure so it can be tested independently of Firestore; the actual
 * member-status reads happen in `dispatchBatches.ts` / the domain
 * functions that mutate a batch member (see TECHNICAL.md "Batch
 * Dispatch" "Interaction with activeRequestId").
 */
export function computeDispatchBatchStatus(
  memberStatuses: WaterRequestStatus[],
): DispatchBatchStatus {
  return memberStatuses.some((s) => s === "claimed") ? "active" : "completed";
}

/** Operational state visible to dispatchers on the delivery runs list.
 * - `"in_progress"`: at least one member is still `"claimed"` (not yet delivered).
 * - `"all_delivered"`: every member has been physically delivered, but at
 *    least one is awaiting resident confirmation (`"delivered"` status).
 * - `"completed"`: all members are fully resolved (confirmed/disputed)
 *    or no members remain.
 */
export type DeliveryRunDerivedState = "in_progress" | "all_delivered" | "completed";

/** Pure derivation of the run's operational state from its member
 * statuses and load counts. Used by `getAllDispatchBatchSummaries`
 * and testable without Firestore. */
export function deriveRunState(
  members: ReadonlyArray<{ loads: number; status: string }>,
): { derivedState: DeliveryRunDerivedState; totalLoads: number; loadsDelivered: number } {
  const totalLoads = members.reduce((sum, m) => sum + m.loads, 0);
  const claimed = members.filter((m) => m.status === "claimed");
  const delivered = members.filter((m) =>
    ["delivered", "confirmed", "disputed"].includes(m.status),
  );
  const loadsDelivered = delivered.reduce((sum, m) => sum + m.loads, 0);

  let derivedState: DeliveryRunDerivedState;
  if (claimed.length > 0) {
    derivedState = "in_progress";
  } else if (delivered.length > 0 && delivered.some((m) => m.status === "delivered")) {
    derivedState = "all_delivered";
  } else {
    derivedState = "completed";
  }

  return { derivedState, totalLoads, loadsDelivered };
}
