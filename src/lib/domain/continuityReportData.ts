/**
 * Pure operational-continuity-snapshot data selection/transformation
 * logic — deliberately factored out of `continuityReport.ts` (which has
 * a `server-only` guard and Firestore dependencies) so it can be unit
 * tested directly, same pattern as `dispatchSelection.ts` for
 * `dispatch.ts`. See PRODUCT.md / TECHNICAL.md "Operational Continuity
 * Snapshot".
 *
 * PRIVACY: this module intentionally never reads or copies
 * `waterSituation` (vulnerable-circumstance details, persons affected,
 * critical explanation) onto a report row — the continuity report needs
 * enough information for staff to manually complete deliveries during
 * an outage, not the resident's sensitive circumstances. See PRODUCT.md
 * "Water Situation Privacy".
 */

import { priorityRankFor } from "./priority";
import type { DispatchPriority, RequestedLoads, WaterLoadCollection, WaterRequest, WaterRequestStatus } from "./types";

/** Statuses that represent a load still waiting for a driver to claim it. */
const UNASSIGNED_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
];

export interface UnassignedReportRow {
  requestId: string;
  priority: DispatchPriority;
  customerName: string;
  phone: string | null;
  village: string;
  deliveryDirections: string;
  requestNotes: string | null;
  /** ISO timestamp. */
  requestedAt: string;
  /** Minutes elapsed between `requestedAt` and report generation time. */
  ageMinutes: number;
  preferredDriverName: string | null;
  loads: RequestedLoads;
  gallons: number;
  /** True when dispatch order was manually escalated by staff. */
  isEscalated: boolean;
}

export interface AssignedReportRow {
  requestId: string;
  priority: DispatchPriority;
  customerName: string;
  phone: string | null;
  village: string;
  deliveryDirections: string;
  requestNotes: string | null;
  assignedDriverName: string | null;
  /** ISO timestamp. */
  requestedAt: string;
  /** ISO timestamp, or null if somehow missing on a claimed request. */
  claimedAt: string | null;
  loads: RequestedLoads;
  gallons: number;
  /** True when this load was assigned via Batch Dispatch (see
   * PRODUCT.md / TECHNICAL.md "Batch Dispatch") rather than a normal
   * driver self-claim or single dispatcher assignment. Purely
   * informational for staff reading the continuity report during an
   * outage — batch-assigned undelivered loads must still appear here
   * like any other assigned load, never be hidden. */
  isBatchAssigned: boolean;
  /** Number of physical loads already collected (0, 1, or 2). */
  loadsCollected: number;
  /** Per-load collection snapshots (compact summary for operational recovery). */
  collectionDetails: Array<{
    loadNumber: 1 | 2;
    fillStationName: string;
    meterCode: string;
    meterNumber: number;
  }>;
}

export interface ContinuityReportData {
  /** ISO timestamp of when this snapshot was generated. */
  generatedAt: string;
  unassigned: UnassignedReportRow[];
  assigned: AssignedReportRow[];
}

function sortByPriorityThenAge(a: WaterRequest, b: WaterRequest): number {
  const rankDiff = priorityRankFor(a.dispatchPriority) - priorityRankFor(b.dispatchPriority);
  if (rankDiff !== 0) return rankDiff;
  return new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
}

/**
 * Builds the continuity report's data (both sections) from already-
 * fetched requests. Pure — no Firestore access, no side effects, safe
 * to call repeatedly (idempotent) and to unit test directly.
 *
 * @param requests Outstanding requests to include — callers are
 *   responsible for excluding "delivered"/"confirmed"/"cancelled"
 *   requests (see `getOutstandingRequestsForContinuityReport` in
 *   `waterRequests.ts`); this function additionally defends against a
 *   caller accidentally passing other statuses by filtering again here.
 * @param driverNamesByUserId Map of driver Firebase uid ->
 *   display name, for resolving `preferredDriverId`/`assignedDriverId`.
 * @param generatedAt The snapshot's generation time (defaults to now).
 */
export function buildContinuityReportData(
  requests: WaterRequest[],
  driverNamesByUserId: Map<string, string>,
  generatedAt: Date = new Date(),
): ContinuityReportData {
  const unassignedRequests = requests
    .filter((r) => UNASSIGNED_STATUSES.includes(r.status))
    .sort(sortByPriorityThenAge);
  const assignedRequests = requests
    .filter((r) => r.status === "claimed")
    .sort(sortByPriorityThenAge);

  const unassigned: UnassignedReportRow[] = unassignedRequests.map((r) => ({
    requestId: r.id,
    priority: r.dispatchPriority,
    customerName: r.customer?.displayName || "Unknown",
    phone: r.customer?.phone ?? null,
    village: r.village,
    deliveryDirections: r.deliveryDirections,
    requestNotes: r.requestNotes,
    requestedAt: r.requestedAt,
    ageMinutes: Math.max(
      0,
      Math.round((generatedAt.getTime() - new Date(r.requestedAt).getTime()) / 60_000),
    ),
    preferredDriverName: r.preferredDriverId
      ? (driverNamesByUserId.get(r.preferredDriverId) ?? "Unknown driver")
      : null,
    loads: r.loads,
    gallons: r.gallons,
    isEscalated: r.dispatchOverrideRank != null,
  }));

  const assigned: AssignedReportRow[] = assignedRequests.map((r) => {
    const collections: WaterLoadCollection[] = r.loadCollections ?? [];
    return {
      requestId: r.id,
      priority: r.dispatchPriority,
      customerName: r.customer?.displayName || "Unknown",
      phone: r.customer?.phone ?? null,
      village: r.village,
      deliveryDirections: r.deliveryDirections,
      requestNotes: r.requestNotes,
      assignedDriverName: r.assignedDriverId
        ? (driverNamesByUserId.get(r.assignedDriverId) ?? "Unknown driver")
        : null,
      requestedAt: r.requestedAt,
      claimedAt: r.claimedAt,
      loads: r.loads,
      gallons: r.gallons,
      isBatchAssigned: Boolean(r.dispatchBatchId),
      loadsCollected: collections.length,
      collectionDetails: collections.map((lc) => ({
        loadNumber: lc.loadNumber,
        fillStationName: lc.fillStationName,
        meterCode: lc.meterCode,
        meterNumber: lc.meterNumber,
      })),
    };
  });

  return { generatedAt: generatedAt.toISOString(), unassigned, assigned };
}
