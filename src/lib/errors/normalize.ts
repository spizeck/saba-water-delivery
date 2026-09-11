/**
 * Error normalization: turn any thrown value into a canonical `AppError`, and
 * build a redacted server-side context object for logging.
 *
 * Imports only the leaf logging modules (`serializeError`, `redaction`) — never
 * the logging barrel — so there is no import cycle with the request boundary.
 */

import { redactValue } from "@/lib/logging/redaction";
import { serializeError } from "@/lib/logging/serializeError";

import { AppError, AppInternalError, isAppError } from "./appError";

/**
 * Returns a canonical `AppError` for any input:
 *   - an existing `AppError` is returned unchanged (its intended status, code,
 *     and safe message are preserved);
 *   - any other `Error` becomes a generic `AppInternalError`, keeping the
 *     original as `cause` for redacted server-side logging;
 *   - a non-Error throwable becomes a generic `AppInternalError` with the value
 *     redacted into `cause`.
 *
 * The original exception message is never promoted to the client message.
 */
export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppInternalError(undefined, { cause: error });
  }

  return new AppInternalError(undefined, { cause: redactValue(error) });
}

/**
 * Redacted, JSON-safe context for logging a boundary failure. Includes the
 * category/code and the normalized (safe) message, plus the ORIGINAL error as a
 * sanitized `cause` (name/code/message/stack via serializeError) so operators
 * can diagnose without any secret, PII, or provider payload leaking.
 */
export function buildServerErrorContext(
  error: unknown,
): Record<string, unknown> {
  const appError = normalizeError(error);

  return {
    category: appError.category,
    code: appError.code,
    errorType: appError.name,
    // appError.message is the internal/developer message; for internal errors
    // it is a fixed generic string, never a raw provider/exception message.
    message: appError.message,
    cause:
      appError.cause === undefined
        ? undefined
        : appError.cause instanceof Error
          ? serializeError(appError.cause)
          : redactValue(appError.cause),
  };
}
