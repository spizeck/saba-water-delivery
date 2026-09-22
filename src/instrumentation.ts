import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

import {
  isExpectedBusinessError,
  resolveSentryEnv,
} from "@/lib/monitoring/sentryShared";

export async function register() {
  if (!resolveSentryEnv().enabled) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Next.js calls this for errors that escape rendering, route handlers, and
 * Server Actions. Expected business-state errors (SCREAMING_SNAKE domain
 * codes, AppError < 500) are logged normally by the structured logger and
 * must not become Sentry incidents.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (isExpectedBusinessError(error)) return;
  await Sentry.captureRequestError(error, request, context);
};
