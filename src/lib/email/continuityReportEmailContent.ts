/**
 * Pure email-content logic for the continuity report — recipient
 * parsing, configuration reading, and payload construction — factored
 * out of `continuityReportEmail.ts` (which has a `server-only` guard
 * because it calls the Resend SDK) so it can be unit tested directly,
 * same pattern as `dispatchSelection.ts` / `continuityReportData.ts`.
 *
 * Reading `process.env` here is safe even if this module were ever
 * imported from a Client Component: Next.js never inlines non-
 * `NEXT_PUBLIC_` environment variables into the client bundle, so
 * `RESEND_API_KEY` would simply be `undefined` there — never a leaked
 * secret. The actual Resend API call (in `continuityReportEmail.ts`)
 * still carries the `server-only` guard.
 */

import type { ContinuityReportData } from "@/lib/domain/continuityReport";
import { continuityReportPdfFilename } from "@/lib/reports/continuityReportFilename";
import { formatSabaDateTime, sabaCalendarDateKey } from "@/lib/utils/datetime";

export interface ContinuityReportEmailConfig {
  apiKey: string;
  from: string;
  /** Parsed, trimmed, non-empty recipient list. */
  to: string[];
}

/**
 * Parses a comma-separated recipient list from an environment variable,
 * trimming whitespace and dropping empty entries. E.g.
 * `"a@example.com, b@example.com"` -> `["a@example.com", "b@example.com"]`.
 */
export function parseRecipientList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Reads and validates Resend configuration from environment variables.
 * Returns null (never throws) if not fully configured, so callers can
 * give a clear, non-crashing error. See .env.example. */
export function getContinuityReportEmailConfig(): ContinuityReportEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTINUITY_REPORT_EMAIL_FROM;
  const toRaw = process.env.CONTINUITY_REPORT_EMAIL_TO;

  if (!apiKey || !from || !toRaw) return null;

  const to = parseRecipientList(toRaw);
  if (to.length === 0) return null;

  return { apiKey, from, to };
}

export interface ContinuityReportEmailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}

/**
 * Builds the exact payload sent to Resend's `emails.send()` — pure and
 * side-effect-free, so the email content (from/to/subject/body/
 * attachment) can be verified without mocking the Resend SDK or making
 * a network call.
 */
export function buildContinuityReportEmailPayload(
  pdfBuffer: Buffer,
  data: ContinuityReportData,
  config: ContinuityReportEmailConfig,
): ContinuityReportEmailPayload {
  const sabaDate = sabaCalendarDateKey(data.generatedAt);

  return {
    from: config.from,
    to: config.to,
    subject: `Saba Water Delivery - Outstanding Delivery Snapshot (${sabaDate})`,
    text:
      "Attached is the Saba Water Delivery outstanding delivery snapshot generated " +
      `at 8:00 PM Saba time (${formatSabaDateTime(data.generatedAt)} Saba Time).\n\n` +
      "This report reflects the assigned and unassigned delivery workload at the " +
      "time shown in the PDF.",
    attachments: [
      {
        filename: continuityReportPdfFilename(data.generatedAt),
        content: pdfBuffer,
      },
    ],
  };
}
