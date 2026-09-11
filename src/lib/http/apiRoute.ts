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
  setRequestIdHeader,
  withLogContext,
} from "@/lib/logging";

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
): (request: NextRequest, ...args: Args) => Promise<Response> {
  const logger = getLogger(`api.${name}`);

  return (request: NextRequest, ...args: Args): Promise<Response> => {
    const requestId = extractRequestId(request);
    const method = request.method;
    const pathname = request.nextUrl?.pathname;
    const startedAt = Date.now();

    return withLogContext({ requestId }, async () => {
      try {
        const response = await handler(request, ...args);
        setRequestIdHeader(response, requestId);
        logger.info(`api.${name}.completed`, {
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
