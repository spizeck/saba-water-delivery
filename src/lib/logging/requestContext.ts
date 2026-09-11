import { type NextRequest, NextResponse } from "next/server";

import { generateId, getLogger, withLogContext } from "./logger";
import { serializeError } from "./serializeError";

/**
 * Request / correlation ID handling for HTTP route flows.
 *
 * A request ID ties every log line for one request together, and is echoed
 * back in the `x-request-id` response header so an operator can correlate a
 * user-reported failure with the logs. IDs are random UUIDs — never anything
 * personally identifying.
 *
 * `withRequestLogging` is intentionally lighter than a full error-handling
 * framework: it adds the ambient request ID, logs completion/failure, and sets
 * the response header, but it does NOT reshape responses or convert errors into
 * client payloads — each route keeps its own status codes and error handling.
 * (A broader error-normalization layer is out of scope here; see issue #30.)
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

function setRequestIdHeader(response: NextResponse, requestId: string): void {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // A header that cannot be set must never fail the request.
  }
}

/**
 * Wraps a Next.js route handler so that, for its whole execution:
 *   - a request ID is resolved (inbound header or generated) and made ambient
 *     via the async log context, so downstream logs share it;
 *   - the request ID is returned in the `x-request-id` response header;
 *   - a completion log records method, path, status, and duration;
 *   - an unhandled error is logged safely and then re-thrown unchanged.
 */
export function withRequestLogging(
  name: string,
  handler: (request: NextRequest) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  const logger = getLogger(`api.${name}`);

  return (request: NextRequest): Promise<NextResponse> => {
    const requestId = extractRequestId(request);
    const method = request.method;
    const pathname = request.nextUrl?.pathname;
    const startedAt = Date.now();

    return withLogContext({ requestId }, async () => {
      try {
        const response = await handler(request);
        setRequestIdHeader(response, requestId);
        logger.info(`api.${name}.completed`, {
          method,
          pathname,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        logger.error(`api.${name}.unhandled_error`, {
          method,
          pathname,
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
        });
        // Preserve existing behavior — the platform still turns this into a 500.
        throw error;
      }
    });
  };
}
