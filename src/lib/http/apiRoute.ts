import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";

import {
  buildApiErrorResponse,
  buildServerErrorContext,
  normalizeError,
} from "@/lib/errors";
import {
  extractRequestId,
  getLogger,
  type LogLevel,
  setRequestIdHeader,
  withLogContext,
} from "@/lib/logging";
import { captureServerError } from "@/lib/monitoring/serverCapture";

export interface WithApiRouteOptions {
  /**
   * Level for the routine per-request `api.<name>.completed` log. Defaults to
   * `"info"`. High-frequency endpoints that are polled by external uptime
   * monitors — `/api/health`, `/api/readiness` — pass `"debug"` so a successful
   * probe stays quiet in production (which runs at `LOG_LEVEL=info`) instead of
   * flooding Vercel logs on every check. It only affects the routine completion
   * line: a genuine server fault is still logged at `error`, and a handler that
   * records its own operational event (e.g. `health.readiness.failed`) is
   * unaffected. See TECHNICAL.md "Health and readiness endpoints".
   */
  completionLogLevel?: LogLevel;
}

/**
 * The canonical API route boundary — the ONE mechanism a route handler should
 * use. It combines request/correlation IDs, structured logging, and error
 * normalization so every route behaves consistently. It replaces #29's
 * `withRequestLogging`, extending it with safe error responses.
 *
 * For the whole handler execution it:
 *   - resolves a request ID (safe inbound `x-request-id` header or a generated
 *     UUID) and makes it ambient (AsyncLocalStorage), so downstream logs share
 *     it;
 *   - returns the handler's own response with the `x-request-id` header added
 *     and a completion log (method/path/status/duration);
 *   - on an UNEXPECTED throw, normalizes the error, logs it ONCE, and returns a
 *     safe canonical response (`@/lib/errors`) whose `x-request-id` header AND
 *     body both carry the request ID — closing the #29 gap where a thrown route
 *     yielded a platform 500 with no correlation ID.
 *
 * Framework control-flow signals (`redirect()`, `notFound()`) are not errors:
 * `unstable_rethrow` lets them reach Next unchanged, so authorization redirects
 * (`requireRole`) keep working.
 *
 * Boundary logging ownership: this boundary owns logging of UNHANDLED throws.
 * Handlers/domain code that catch a failure and RETURN a response (or degrade
 * gracefully) log their own distinct operational events and must NOT also
 * re-throw the same error, so a single failure is never logged twice.
 *
 * Generic over the handler's extra arguments, so it wraps both plain handlers
 * `(request)` and dynamic routes `(request, { params })`.
 */
export function withApiRoute<Args extends unknown[]>(
  name: string,
  handler: (request: NextRequest, ...args: Args) => Promise<Response>,
  options: WithApiRouteOptions = {},
): (request: NextRequest, ...args: Args) => Promise<Response> {
  const logger = getLogger(`api.${name}`);
  const completionLogLevel = options.completionLogLevel ?? "info";

  return (request: NextRequest, ...args: Args): Promise<Response> => {
    const requestId = extractRequestId(request);
    const method = request.method;
    const pathname = request.nextUrl?.pathname;
    const startedAt = Date.now();

    return withLogContext({ requestId }, async () => {
      try {
        const response = await handler(request, ...args);
        setRequestIdHeader(response, requestId);
        logger[completionLogLevel](`api.${name}.completed`, {
          method,
          pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        // Framework control-flow (redirect()/notFound()) is not an error — let
        // it reach Next unchanged so auth redirects etc. keep working.
        unstable_rethrow(error);

        const appError = normalizeError(error);
        const durationMs = Date.now() - startedAt;

        if (appError.statusCode >= 500) {
          // A genuine server fault. Log the sanitized cause once — this
          // boundary owns unhandled-error logging.
          logger.error(`api.${name}.unhandled_error`, {
            method,
            pathname,
            status: appError.statusCode,
            durationMs,
            error: buildServerErrorContext(error),
          });
          // Sentry (issue #115): report the same unexpected failure once,
          // tagged with the correlation id and logical route name. Expected
          // business-state errors are filtered inside captureServerError;
          // a monitoring failure can never propagate.
          await captureServerError(error, {
            route: `api.${name}`,
            requestId,
          });
        } else {
          // A handler that threw an expected AppError (e.g. a 4xx) — not a
          // server fault, so log at warn without a stack.
          logger.warn(`api.${name}.client_error`, {
            method,
            pathname,
            status: appError.statusCode,
            code: appError.code,
            durationMs,
          });
        }

        const response = buildApiErrorResponse(appError, requestId);
        setRequestIdHeader(response, requestId);
        return response;
      }
    });
  };
}
