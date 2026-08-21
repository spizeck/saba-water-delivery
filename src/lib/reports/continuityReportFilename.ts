/**
 * Pure filename helper for the continuity report PDF — factored out of
 * `continuityReportPdf.ts` (which has a `server-only` guard because it
 * uses `pdfkit`) so it can be unit tested directly, same pattern as
 * `dispatchSelection.ts` / `continuityReportData.ts`.
 */

import { sabaCalendarDateKey } from "@/lib/utils/datetime";

/**
 * Filename for the continuity report PDF, whether streamed to the
 * browser (manual download) or attached to the nightly/manual email.
 * Uses the Saba LOCAL calendar date, not the server/UTC date — the
 * nightly report is generated at 8:00 PM Saba time, which is midnight
 * UTC, so the UTC calendar date can be a day ahead of the Saba calendar
 * date at that exact moment. Contains no customer data — see
 * PRODUCT.md "Privacy".
 */
export function continuityReportPdfFilename(generatedAt: string): string {
  return `saba-water-delivery-snapshot-${sabaCalendarDateKey(generatedAt)}.pdf`;
}
