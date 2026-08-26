/**
 * Pure data selection/transformation for the Batch Dispatch printable
 * driver run sheet — deliberately factored out of `dispatchBatchPdf.ts`
 * (which has a `server-only` guard because it uses `pdfkit`) so it can
 * be unit tested directly, same pattern as `continuityReportData.ts`.
 * See PRODUCT.md / TECHNICAL.md "Batch Dispatch".
 *
 * PRIVACY: like the continuity report, this module never reads or
 * copies `waterSituation` (vulnerable-circumstance details, persons
 * affected, critical explanation) onto a row, and never includes a
 * Firestore document ID or customer email — a driver run sheet needs
 * enough information to physically complete deliveries, not the
 * resident's sensitive circumstances or internal identifiers. See
 * PRODUCT.md "Water Situation Privacy".
 */

import type { DispatchPriority, RequestedLoads, WaterRequest, WaterRequestStatus } from "./types";

export interface DispatchBatchPdfRow {
  /** 1-based run-sheet position. */
  sequence: number;
  customerName: string;
  phone: string | null;
  village: string;
  deliveryDirections: string;
  loads: RequestedLoads;
  gallons: number;
  priority: DispatchPriority;
  /** ISO timestamp. */
  requestedAt: string;
  /** Minutes elapsed between `requestedAt` and report generation time. */
  ageMinutesAtGeneration: number;
  /** Name of the resident's originally preferred driver, if any. */
  preferredDriverName: string | null;
  /** False when `preferredDriverName` represents a DIFFERENT driver
   * than the one this batch was assigned to — i.e. this load's
   * inclusion in the batch overrode that preference. */
  preferredDriverIsBatchDriver: boolean;
  /** Current status, used to decide whether to print a blank paper
   * completion area or an "already resolved" line — see PRODUCT.md
   * "Batch Dispatch" "Reprint". */
  status: WaterRequestStatus;
  deliveredAt: string | null;
  confirmedAt: string | null;
}

export interface DispatchBatchPdfData {
  batchId: string;
  driverName: string;
  /** ISO timestamp of when this run sheet was generated/reprinted. */
  generatedAt: string;
  rows: DispatchBatchPdfRow[];
}

/**
 * Builds the run sheet's data from the batch's CURRENT member requests
 * (already fetched via `getRequestsForDispatchBatch`) — a reprint
 * always reflects current state (including any load already delivered,
 * confirmed, or disputed since the batch was created), never a frozen
 * snapshot of the original assignment. See PRODUCT.md "Batch Dispatch"
 * "Reprint" for why this was chosen over reproducing the original
 * assignment exactly.
 */
export function buildDispatchBatchPdfData(
  batchId: string,
  driverId: string,
  driverName: string,
  requests: WaterRequest[],
  driverNamesByUserId: Map<string, string>,
  generatedAt: Date = new Date(),
): DispatchBatchPdfData {
  const rows: DispatchBatchPdfRow[] = [...requests]
    .sort((a, b) => (a.batchSequence ?? 0) - (b.batchSequence ?? 0))
    .map((r, index) => ({
      sequence: r.batchSequence ?? index + 1,
      customerName: r.customer?.displayName || "Unknown",
      phone: r.customer?.phone ?? null,
      village: r.village,
      deliveryDirections: r.deliveryDirections,
      loads: r.loads,
      gallons: r.gallons,
      priority: r.dispatchPriority,
      requestedAt: r.requestedAt,
      ageMinutesAtGeneration: Math.max(
        0,
        Math.round((generatedAt.getTime() - new Date(r.requestedAt).getTime()) / 60_000),
      ),
      preferredDriverName: r.preferredDriverId
        ? (driverNamesByUserId.get(r.preferredDriverId) ?? "Unknown driver")
        : null,
      preferredDriverIsBatchDriver: r.preferredDriverId === driverId,
      status: r.status,
      deliveredAt: r.deliveredAt,
      confirmedAt: r.confirmedAt,
    }));

  return { batchId, driverName, generatedAt: generatedAt.toISOString(), rows };
}
