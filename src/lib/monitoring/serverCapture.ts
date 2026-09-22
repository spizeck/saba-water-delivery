/**
 * Server-side Sentry capture for unexpected failures (issue #115).
 *
 * Called from the API route boundary (`withApiRoute`) for 5xx-class errors.
 * Expected business-state errors (bare SCREAMING_SNAKE domain codes, AppError
 * below 500) are filtered here AND by the SDK's `beforeSend` scrubber —
 * defense in depth, since `onRequestError` in `instrumentation.ts` applies the
 * same rule for render/action errors that bypass the boundary.
 *
 * The dynamic import keeps `@sentry/nextjs` out of cold-start cost when no
 * DSN is configured, and every failure inside this module is swallowed:
 * monitoring must never break the request it observes.
 */

import "server-only";

import { isExpectedBusinessError, resolveSentryEnv } from "./sentryShared";

export interface ServerErrorContext {
  /** Static logical route name, e.g. "api.auth.session" — never a raw path. */
  route?: string;
  requestId?: string;
  component?: string;
}

/**
 * Reports an unexpected server error to Sentry with allowlisted operational
 * tags. Returns the Sentry event id when sent, `undefined` when filtered,
 * disabled, or failed.
 */
export async function captureServerError(
  error: unknown,
  context: ServerErrorContext = {},
): Promise<string | undefined> {
  try {
    if (!resolveSentryEnv().enabled || isExpectedBusinessError(error)) {
      return undefined;
    }

    const Sentry = await import("@sentry/nextjs");
    const eventId = Sentry.withScope((scope) => {
      if (context.route) scope.setTag("route", context.route);
      if (context.requestId) scope.setTag("requestId", context.requestId);
      if (context.component) scope.setTag("component", context.component);
      const env = resolveSentryEnv();
      if (env.deploymentId) scope.setTag("deploymentId", env.deploymentId);
      scope.setTag("capture", "apiRouteBoundary");
      return Sentry.captureException(error);
    });

    // Vercel may freeze the isolate as soon as the response is returned;
    // a bounded flush keeps the envelope without delaying failures.
    await Sentry.flush(2000);
    return eventId;
  } catch {
    return undefined;
  }
}
