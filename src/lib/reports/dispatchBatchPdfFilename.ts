/**
 * Pure filename helper for the Batch Dispatch driver run sheet PDF —
 * factored out of `dispatchBatchPdf.ts` (which has a `server-only`
 * guard because it uses `pdfkit`) so it can be unit tested directly,
 * same pattern as `continuityReportFilename.ts`.
 */

import { sabaCalendarDateKey } from "@/lib/utils/datetime";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "driver";
}

/**
 * Filename for a batch's run sheet PDF, whether freshly generated or
 * reprinted. Uses the Saba LOCAL calendar date at generation time, same
 * convention as `continuityReportPdfFilename()`. Contains the driver's
 * name (useful for staff sorting printed files) and a short batch
 * identifier, but no customer data.
 */
export function dispatchBatchPdfFilename(
  batchId: string,
  driverName: string,
  generatedAt: string,
): string {
  const shortBatchId = batchId.slice(0, 8);
  return `saba-water-delivery-dispatch-sheet-${slugify(driverName)}-${shortBatchId}-${sabaCalendarDateKey(generatedAt)}.pdf`;
}
