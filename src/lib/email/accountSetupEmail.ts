import "server-only";

/**
 * Email delivery for dispatcher-initiated account setup invitations.
 *
 * Uses Resend, the same provider as the continuity report email, so there
 * is only one email provider to configure. Like the continuity report
 * sender, this module never throws — it returns `{ ok: false, error }` on
 * failure so the optional invitation step cannot block creation of a
 * valid water request.
 */

import { Resend } from "resend";

import {
  buildAccountSetupEmailPayload,
  getAccountSetupEmailConfig,
  type AccountSetupEmailInput,
} from "./accountSetupEmailContent";

export interface SendAccountSetupEmailResult {
  ok: boolean;
  /** Non-secret diagnostic reason, safe to log. */
  error?: string;
}

/**
 * Sends a branded account-setup invitation to a new resident. Never
 * throws. A failed send is reported to the dispatcher UI but does not
 * roll back the water request.
 */
export async function sendAccountSetupEmail(
  input: AccountSetupEmailInput,
): Promise<SendAccountSetupEmailResult> {
  const config = getAccountSetupEmailConfig();
  if (!config) {
    return {
      ok: false,
      error:
        "Account setup email is not configured. Set RESEND_API_KEY and " +
        "ACCOUNT_SETUP_EMAIL_FROM (or reuse CONTINUITY_REPORT_EMAIL_FROM) " +
        "environment variables (see .env.example).",
    };
  }

  try {
    const resend = new Resend(config.apiKey);
    const payload = buildAccountSetupEmailPayload(input, config);
    const { error } = await resend.emails.send(payload);

    if (error) {
      return { ok: false, error: error.message || "Resend returned an error." };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email send error";
    return { ok: false, error: message };
  }
}
