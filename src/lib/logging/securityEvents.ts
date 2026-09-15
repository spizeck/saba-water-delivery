/**
 * Security event reporting, built on the canonical structured logger (#29) —
 * NOT a separate logging backend.
 *
 * Security events are noteworthy authorization/validation failures worth
 * monitoring: a forged webhook, an unauthorized cron hit, or an authenticated
 * user attempting a privileged action they lack the role for. Routine
 * authentication failures (an expired/invalid session at sign-in) are ordinary
 * application behavior and are NOT security events — they stay as plain
 * operational logs so the security stream is not drowned in noise.
 *
 * These are operational telemetry, separate from the durable Firestore business
 * audit trail. They obey #29's redaction policy: pass only safe metadata
 * (internal opaque IDs, role names, request IDs) — never tokens, cookies,
 * signatures, request bodies, phone numbers, emails, or other personal data.
 */

import { getLogger } from "./logger";

/** Stable security event names (namespace: `security.*`). */
export const SECURITY_EVENTS = {
  /** Authenticated caller attempted an action their roles do not allow. */
  authorizationDenied: "security.authorization.denied",
  /** Inbound webhook failed HMAC signature verification. */
  webhookSignatureInvalid: "security.webhook.signature_invalid",
  /** Protected cron endpoint hit without valid authorization. */
  cronUnauthorized: "security.cron.unauthorized",
  /** A caller exceeded a rate-limit policy for an abuse-sensitive operation. */
  rateLimitExceeded: "security.rate_limit.exceeded",
  /**
   * A uid whose account was merged away presented an otherwise-valid
   * credential. The credential is rejected because the durable merge record
   * (not the credential's validity) determines access.
   */
  mergedIdentityRejected: "security.authentication.merged_identity_rejected",
} as const;

const securityLogger = getLogger("security");

/**
 * Records a security event at `warn` severity (noteworthy, not an application
 * error). Metadata is redacted by the logger like any other event.
 */
export function logSecurityEvent(
  event: string,
  metadata?: Record<string, unknown>,
): void {
  securityLogger.warn(event, metadata);
}
