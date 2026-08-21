import "server-only";

/**
 * Email delivery for the nightly operational continuity snapshot — see
 * PRODUCT.md / TECHNICAL.md "Operational Continuity Snapshot".
 *
 * Uses Resend (https://resend.com) as the email provider. Resend was
 * chosen over generic SMTP for a simple, modern, well-documented
 * Node.js SDK with first-class attachment support and clear
 * success/error results — no SMTP transporter/credentials to manage.
 *
 * This is a thin `server-only` wrapper around the actual Resend API
 * call. Recipient parsing, configuration reading, and payload
 * construction are pure logic in `continuityReportEmailContent.ts` so
 * they can be unit tested without mocking the Resend SDK.
 *
 * This module never throws for a missing/invalid configuration or a
 * failed send — the caller (cron route / manual actions) must remain
 * unaffected either way (see TECHNICAL.md "Reliability" for the
 * continuity report). Failures are logged without secrets by the
 * caller; this module never logs the API key.
 */

import { Resend } from "resend";

import type { ContinuityReportData } from "@/lib/domain/continuityReport";

import {
  buildContinuityReportEmailPayload,
  getContinuityReportEmailConfig,
} from "./continuityReportEmailContent";

export {
  getContinuityReportEmailConfig,
  parseRecipientList,
  type ContinuityReportEmailConfig,
} from "./continuityReportEmailContent";

export interface SendContinuityReportEmailResult {
  ok: boolean;
  /** Non-secret diagnostic reason, safe to log, never includes credentials. */
  error?: string;
}

/**
 * Emails the continuity report PDF to the configured recipient(s) via
 * Resend. Never throws — returns `{ ok: false, error }` on any failure
 * (missing configuration, Resend API error, etc.) so a failed send can
 * never affect water-request processing (see TECHNICAL.md
 * "Reliability"). Used identically by the nightly cron job and the
 * staff-only manual "Send Continuity Report Now" action — one send
 * implementation, never duplicated.
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
        "Continuity report email is not configured. Set RESEND_API_KEY, " +
        "CONTINUITY_REPORT_EMAIL_FROM, and CONTINUITY_REPORT_EMAIL_TO environment " +
        "variables (see .env.example).",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const payload = buildContinuityReportEmailPayload(pdfBuffer, data, config);
    const { error } = await resend.emails.send(payload);

    if (error) {
      // Resend's error objects are safe to surface (message/name only,
      // never request credentials).
      return { ok: false, error: error.message || "Resend returned an error." };
    }

    return { ok: true };
  } catch (err) {
    // Never log the API key or full request payload — only a generic,
    // non-secret diagnostic message.
    const message = err instanceof Error ? err.message : "Unknown email send error";
    return { ok: false, error: message };
  }
}
