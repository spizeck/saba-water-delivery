/**
 * Pure email-content logic for account-setup invitations sent by
 * dispatchers on behalf of new residents. Factored out of
 * `accountSetupEmail.ts` so content can be unit tested without mocking
 * the Resend SDK.
 */

export interface AccountSetupEmailConfig {
  apiKey: string;
  from: string;
}

export interface AccountSetupEmailInput {
  to: string;
  displayName: string;
  /** Firebase password-reset/setup link. */
  setupLink: string;
  /** Public application URL, used for fallback/manual navigation. */
  appUrl: string;
}

export interface AccountSetupEmailPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Reads Resend configuration required for account-setup emails. */
export function getAccountSetupEmailConfig(): AccountSetupEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.ACCOUNT_SETUP_EMAIL_FROM?.trim() ||
    process.env.CONTINUITY_REPORT_EMAIL_FROM?.trim();

  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * Builds the branded account-setup email payload. The message explains
 * that the resident can set their own password and access their water
 * delivery information; no password is included or shared.
 */
export function buildAccountSetupEmailPayload(
  input: AccountSetupEmailInput,
  config: AccountSetupEmailConfig,
): AccountSetupEmailPayload {
  const salutation = input.displayName ? `Hi ${input.displayName},` : "Hello,";

  const text = [
    salutation,
    "",
    "An online resident account has been prepared for you for the Saba Water Delivery system.",
    "",
    "Use the secure link below to finish setting up your account and access your water-delivery information:",
    input.setupLink,
    "",
    "You will choose your own password during setup. No one at the Water Delivery Office knows or stores your password.",
    "",
    "If the link above does not work, you can also visit:",
    input.appUrl,
    "",
    "Saba Water Delivery",
  ].join("\n");

  const html = [
    "<!DOCTYPE html>",
    "<html><head><meta charset=\"utf-8\"></head><body>",
    `<p>${salutation}</p>`,
    "<p>An online resident account has been prepared for you for the <strong>Saba Water Delivery</strong> system.</p>",
    "<p>Use the secure link below to finish setting up your account and access your water-delivery information:</p>",
    `<p><a href="${input.setupLink}">${input.setupLink}</a></p>`,
    "<p>You will choose your own password during setup. No one at the Water Delivery Office knows or stores your password.</p>",
    `<p>If the link above does not work, you can also visit <a href="${input.appUrl}">${input.appUrl}</a>.</p>`,
    "<p>Saba Water Delivery</p>",
    "</body></html>",
  ].join("\n");

  return {
    from: config.from,
    to: input.to,
    subject: "Saba Water Delivery - Set up your account",
    text,
    html,
  };
}
