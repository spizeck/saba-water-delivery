/**
 * Canonical client-facing API error response.
 *
 * Shape (flat, chosen for backward compatibility — existing clients such as
 * `establishSession`/`LoginForm` read `data.error` as a string; a nested
 * `{ error: { ... } }` would break them):
 *
 *   { "error": "<safe message>", "code": "<STABLE_CODE>", "requestId": "<id>" }
 *
 * The message is the AppError's own message only when it is public (validation,
 * auth, not-found, conflict, rate-limit); otherwise a generic message is used
 * so no stack trace, provider payload, Firebase internal, secret, or personal
 * data ever reaches the caller. `requestId` lets an operator correlate the
 * response with the server logs.
 */

import { NextResponse } from "next/server";

import { GENERIC_ERROR_MESSAGE, AppRateLimitError } from "./appError";
import { normalizeError } from "./normalize";

export interface ClientErrorBody {
  error: string;
  code: string;
  requestId?: string;
}

/** The safe client body for an error, without building an HTTP response. */
export function buildClientErrorBody(
  error: unknown,
  requestId?: string,
): ClientErrorBody {
  const appError = normalizeError(error);
  return {
    error: appError.isPublic ? appError.message : GENERIC_ERROR_MESSAGE,
    code: appError.code,
    requestId,
  };
}

/**
 * Builds the canonical JSON error response for an API boundary. Uses the
 * normalized status code and adds `Retry-After` for rate-limit errors.
 */
export function buildApiErrorResponse(
  error: unknown,
  requestId?: string,
): NextResponse {
  const appError = normalizeError(error);
  const body = buildClientErrorBody(appError, requestId);

  const response = NextResponse.json(body, { status: appError.statusCode });

  if (appError instanceof AppRateLimitError) {
    response.headers.set("Retry-After", String(appError.retryAfterSeconds));
  }

  return response;
}
