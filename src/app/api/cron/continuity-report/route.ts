import { NextResponse, type NextRequest } from "next/server";

import { generateContinuityReportData } from "@/lib/domain/continuityReport";
import { sendContinuityReportEmail } from "@/lib/email/continuityReportEmail";
import { renderContinuityReportPdf } from "@/lib/reports/continuityReportPdf";

/**
 * Nightly operational continuity snapshot — invoked by Vercel Cron
 * (see `vercel.json`, scheduled for 8:00 PM Saba time) or, in staging,
 * by manual `curl`. See PRODUCT.md / TECHNICAL.md "Operational
 * Continuity Snapshot".
 *
 * Reliability (see TECHNICAL.md "Reliability"):
 *   - Read-only: generates the report from Firestore but never writes
 *     anything, so this is safe to retry — a retry cannot corrupt
 *     dispatch/request state, and generation itself is idempotent.
 *   - A failed email send never touches water-request data; it is only
 *     logged (without secrets) and reflected in the HTTP response so
 *     Vercel's cron dashboard shows the failure.
 *
 * Protected by `CRON_SECRET` (see .env.example) — Vercel Cron
 * automatically sends `Authorization: Bearer $CRON_SECRET` when that
 * environment variable is configured. Requests without a matching
 * header are rejected so this endpoint cannot be triggered by an
 * arbitrary public request.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const data = await generateContinuityReportData();
    const pdfBuffer = await renderContinuityReportPdf(data);
    const result = await sendContinuityReportEmail(pdfBuffer, data);

    if (!result.ok) {
      console.error("[continuity-report] email send failed:", result.error);
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          unassigned: data.unassigned.length,
          assigned: data.assigned.length,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      generatedAt: data.generatedAt,
      unassigned: data.unassigned.length,
      assigned: data.assigned.length,
    });
  } catch (err) {
    console.error("[continuity-report] generation failed:", err);
    return NextResponse.json({ ok: false, error: "Report generation failed." }, { status: 500 });
  }
}
