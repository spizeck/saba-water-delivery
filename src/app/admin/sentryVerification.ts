"use server";

/**
 * TEMPORARY — issue #119 Stage A only.
 *
 * One-shot admin control that sends a single fixed diagnostic exception
 * through the canonical server capture path so Production Sentry ingestion
 * can be verified end-to-end (environment/release/deploymentId, scrubbing,
 * symbolication) without deliberately crashing a real request.
 *
 * Remove this file, `SentryVerificationPanel`, its usage in `page.tsx`, and
 * the temporary test in the Stage B cleanup PR once Production verification
 * is complete.
 */

import { requireRole } from "@/lib/auth/session";
import { captureServerError } from "@/lib/monitoring/serverCapture";
import { resolveSentryEnv } from "@/lib/monitoring/sentryShared";

export interface SentryVerificationResult {
  status: "success" | "error" | "unavailable";
  message: string;
}

/**
 * Fixed, non-SCREAMING_SNAKE message — the value must NOT match the domain's
 * expected-business-error convention or it would be (correctly) filtered.
 */
const VERIFICATION_MESSAGE = "Sentry server verification test - 2026-09-22";

/**
 * Soft repeat guard: one send per cooldown window per serverless instance.
 * Deliberately NOT persisted — this mechanism is temporary and must not gain
 * a database model. Instance churn means it is a courtesy rate-limit, not a
 * hard once-per-deployment lock; the UI confirmation is the real gate.
 */
const COOLDOWN_MS = 60_000;
let lastSentAt = 0;

export async function sendSentryServerVerification(): Promise<SentryVerificationResult> {
  // Authorization is enforced here, server-side — hiding the button in the
  // admin UI is not the boundary.
  await requireRole("admin");

  if (process.env.VERCEL_ENV !== "production") {
    return {
      status: "unavailable",
      message:
        "Sentry verification is only available in the Production deployment.",
    };
  }
  if (!resolveSentryEnv().enabled) {
    return {
      status: "unavailable",
      message: "Sentry is not enabled in this deployment.",
    };
  }
  if (Date.now() - lastSentAt < COOLDOWN_MS) {
    return {
      status: "error",
      message:
        "A verification event was sent recently — check Sentry before sending another.",
    };
  }

  // The error object carries no request data — no user input is accepted,
  // and the event still passes through beforeSend scrubbing.
  const eventId = await captureServerError(new Error(VERIFICATION_MESSAGE), {
    route: "admin.sentryVerification",
    component: "sentry-verification",
    capture: "sentry-verification",
  });
  if (!eventId) {
    return {
      status: "error",
      message:
        "The event was filtered or could not be delivered — check the structured logs.",
    };
  }

  lastSentAt = Date.now();
  return {
    status: "success",
    message:
      "Verification event sent to Sentry. Confirm it appears under the production environment with release/deployment tags.",
  };
}
