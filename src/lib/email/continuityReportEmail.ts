import "server-only";

/**
 * Email delivery for the nightly operational continuity snapshot — see
 * PRODUCT.md / TECHNICAL.md "Operational Continuity Snapshot".
 *
 * Uses generic SMTP via `nodemailer` rather than a specific commercial
 * provider's SDK, since no email infrastructure previously existed in
 * this project (see .env.example) and SMTP works with any provider a
 * government IT department is already using (Google Workspace,
 * Microsoft 365, SendGrid/SES SMTP relay, etc.) without committing to
 * one vendor's API.
 *
 * This module never throws for a missing/invalid configuration or a
 * failed send — the caller (cron route / manual action) must remain
 * unaffected either way (see TECHNICAL.md "Reliability" for the
 * continuity report). Failures are logged without secrets.
 */

import nodemailer from "nodemailer";

import type { ContinuityReportData } from "@/lib/domain/continuityReport";
import { formatSabaDateTime } from "@/lib/utils/datetime";

export interface ContinuityReportEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
}

/** Reads and validates SMTP configuration from environment variables.
 * Returns null (never throws) if not fully configured, so callers can
 * give a clear, non-crashing error. See .env.example. */
export function getContinuityReportEmailConfig(): ContinuityReportEmailConfig | null {
  const host = process.env.CONTINUITY_REPORT_SMTP_HOST;
  const portRaw = process.env.CONTINUITY_REPORT_SMTP_PORT;
  const user = process.env.CONTINUITY_REPORT_SMTP_USER;
  const password = process.env.CONTINUITY_REPORT_SMTP_PASSWORD;
  const from = process.env.CONTINUITY_REPORT_EMAIL_FROM;
  const to = process.env.CONTINUITY_REPORT_EMAIL_TO;

  if (!host || !portRaw || !user || !password || !from || !to) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port)) return null;

  return {
    host,
    port,
    secure: process.env.CONTINUITY_REPORT_SMTP_SECURE === "true",
    user,
    password,
    from,
    to,
  };
}

export interface SendContinuityReportEmailResult {
  ok: boolean;
  /** Non-secret diagnostic reason, safe to log, never includes credentials. */
  error?: string;
}

/**
 * Emails the continuity report PDF to the configured recipient. Never
 * throws — returns `{ ok: false, error }` on any failure (missing
 * configuration, SMTP error, etc.) so a failed send can never affect
 * water-request processing (see TECHNICAL.md "Reliability").
 */
export async function sendContinuityReportEmail(
  pdfBuffer: Buffer,
  data: ContinuityReportData,
): Promise<SendContinuityReportEmailResult> {
  const config = getContinuityReportEmailConfig();
  if (!config) {
    return {
      ok: false,
      error:
        "Continuity report email is not configured. Set CONTINUITY_REPORT_SMTP_* and " +
        "CONTINUITY_REPORT_EMAIL_* environment variables (see .env.example).",
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    });

    const generatedLabel = formatSabaDateTime(data.generatedAt);
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: `Saba Water Delivery — Continuity Snapshot (${generatedLabel} Saba Time)`,
      text:
        `Saba Water Delivery — Outstanding Delivery Snapshot\n` +
        `Generated: ${generatedLabel} Saba Time\n\n` +
        `Unassigned loads: ${data.unassigned.length}\n` +
        `Assigned loads: ${data.assigned.length}\n\n` +
        `This is a snapshot, not live data. See the attached PDF for full details. ` +
        `This report reflects the delivery queue as of the generated time shown above.`,
      attachments: [
        {
          filename: `continuity-snapshot-${data.generatedAt.slice(0, 10)}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return { ok: true };
  } catch (err) {
    // Never log the transporter config (contains credentials) — only a
    // generic, non-secret diagnostic message.
    const message = err instanceof Error ? err.message : "Unknown email send error";
    return { ok: false, error: message };
  }
}
