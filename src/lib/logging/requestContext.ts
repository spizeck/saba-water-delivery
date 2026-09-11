import type { NextRequest } from "next/server";

import { generateId } from "./logger";

/**
 * Request / correlation ID primitives for HTTP route flows.
 *
 * A request ID ties every log line for one request together and is echoed back
 * in the `x-request-id` response header so an operator can correlate a
 * user-reported failure with the logs. IDs are random UUIDs — never anything
 * personally identifying.
 *
 * The canonical route boundary that USES these primitives (request context +
 * structured logging + error normalization) is `withApiRoute` in
 * `@/lib/http` — see TECHNICAL.md "Server error handling".
 */

export const REQUEST_ID_HEADER = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 64;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9\-_]+$/;

/** Generates a fresh random request/correlation ID. */
export function generateRequestId(): string {
  return generateId();
}

/**
 * Accepts an inbound request-ID header only if it is short and matches a safe
 * character set, so a caller cannot inject arbitrary content into logs.
 */
export function sanitizeRequestId(
  value: string | null | undefined,
): string | undefined {
  if (!value || value.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }
  return REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

/** Uses a safe inbound `x-request-id`, otherwise generates one. */
export function extractRequestId(request: NextRequest): string {
  return (
    sanitizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ??
    generateRequestId()
  );
}

/** Sets the `x-request-id` header on a response, never throwing if it can't. */
export function setRequestIdHeader(
  response: Response,
  requestId: string,
): void {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // A header that cannot be set must never fail the request.
  }
}
