import "server-only";

/**
 * Server-side orchestration for the nightly/manual operational
 * continuity snapshot — see PRODUCT.md / TECHNICAL.md "Operational
 * Continuity Snapshot". This module only reads Firestore; it never
 * writes anything, so generation is inherently safe to retry (a failed
 * or duplicated run cannot corrupt request/driver state).
 *
 * The actual data selection/transformation is in the pure
 * `continuityReportData.ts` module so it can be unit tested without a
 * Firestore/Admin SDK context.
 */

import { getAllDriverRegistryEntries } from "./driverRegistry";
import { buildContinuityReportData, type ContinuityReportData } from "./continuityReportData";
import { getOutstandingRequestsForContinuityReport } from "./waterRequests";

export type { ContinuityReportData, UnassignedReportRow, AssignedReportRow } from "./continuityReportData";

/**
 * Generates the current continuity snapshot data. Read-only — see
 * module doc comment above. Used identically by the nightly cron job
 * and the staff-only manual "Generate Continuity Report" action, so
 * there is exactly one report-generation code path (see DEVIN.md "Do
 * Not Overbuild").
 */
export async function generateContinuityReportData(): Promise<ContinuityReportData> {
  const [requests, drivers] = await Promise.all([
    getOutstandingRequestsForContinuityReport(),
    getAllDriverRegistryEntries(),
  ]);

  const driverNamesByUserId = new Map<string, string>();
  for (const driver of drivers) {
    if (driver.linkedUserId) {
      driverNamesByUserId.set(driver.linkedUserId, driver.displayName);
    }
  }

  return buildContinuityReportData(requests, driverNamesByUserId, new Date());
}
