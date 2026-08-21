import { requireRole } from "@/lib/auth/session";
import { generateContinuityReportData } from "@/lib/domain/continuityReport";
import { renderContinuityReportPdf } from "@/lib/reports/continuityReportPdf";

/**
 * Staff-only manual "Generate Continuity Report" download — see
 * PRODUCT.md / TECHNICAL.md "Operational Continuity Snapshot". Uses the
 * exact same report-generation and PDF-rendering code as the nightly
 * cron job (`src/app/api/cron/continuity-report/route.ts`) — there is
 * only one report implementation.
 *
 * The PDF is generated on demand and streamed directly to the browser;
 * it is never written to public storage, so there is no publicly
 * guessable URL for it (see PRODUCT.md "Privacy"). Access is restricted
 * to `dispatcher`/`admin` via the same session-cookie authorization
 * used by the rest of the dispatcher/admin portals — `requireRole`
 * redirects an unauthenticated or unauthorized request rather than
 * exposing operational/customer data.
 */
export async function GET() {
  await requireRole(["dispatcher", "admin"]);

  const data = await generateContinuityReportData();
  const pdfBuffer = await renderContinuityReportPdf(data);
  const filename = `saba-water-continuity-snapshot-${data.generatedAt.slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
