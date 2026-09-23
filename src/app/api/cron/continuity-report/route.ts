import { NextResponse, type NextRequest } from "next/server";

import { generateContinuityReportData } from "@/lib/domain/continuityReport";
import { sendContinuityReportEmail } from "@/lib/email/continuityReportEmail";
import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";
import { withApiRoute } from "@/lib/http";
import { recordCronHeartbeat } from "@/lib/monitoring/cronHeartbeat";
import { renderContinuityReportPdf } from "@/lib/reports/continuityReportPdf";

const log = getLogger("api.cron.continuity-report");

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
export const GET = withApiRoute(
  "cron.continuity-report",
  async (request: NextRequest) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error("report.continuity.cron_secret_missing");
      return NextResponse.json(
        { ok: false, error: "Service unavailable" },
        { status: 503 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logSecurityEvent(SECURITY_EVENTS.cronUnauthorized, {
        route: "cron.continuity-report",
      });
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const startedAt = Date.now();
    try {
      const data = await generateContinuityReportData();
      const pdfBuffer = await renderContinuityReportPdf(data);
      const result = await sendContinuityReportEmail(pdfBuffer, data);

      if (!result.ok) {
        log.error("report.continuity.email_failed", {
          unassigned: data.unassigned.length,
          assigned: data.assigned.length,
          // Provider error string; redaction masks any embedded PII/URLs.
          providerError: result.error,
        });
        await recordCronHeartbeat("continuity-report", "failure");
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

      log.info("report.continuity.generated", {
        generatedAt: data.generatedAt,
        unassigned: data.unassigned.length,
        assigned: data.assigned.length,
        durationMs: Date.now() - startedAt,
      });
      await recordCronHeartbeat("continuity-report", "success");
      return NextResponse.json({
        ok: true,
        generatedAt: data.generatedAt,
        unassigned: data.unassigned.length,
        assigned: data.assigned.length,
      });
    } catch (err) {
      log.error("report.continuity.generation_failed", {
        durationMs: Date.now() - startedAt,
        error: serializeError(err),
      });
      await recordCronHeartbeat("continuity-report", "failure");
      return NextResponse.json(
        { ok: false, error: "Report generation failed." },
        { status: 500 },
      );
    }
  },
);
