/**
 * Safe error serialization for operational logs.
 *
 * Extracts only a small allowlist of fields from an error — never spreads an
 * arbitrary provider error object, which may carry request config, headers,
 * URLs with tokens, or a response body containing personal data. The message
 * and stack are run through the redaction layer so any secret/PII/URL that a
 * library baked into them is masked.
 */

import { redactUrlsInText, redactValue } from "./redaction";

export interface SerializedError {
  /** Error class name, e.g. "TypeError" or "FirebaseError". */
  name: string;
  /** Redacted error message, when one is present. */
  message?: string;
  /** Safe application/library error code, e.g. Firebase "auth/...". */
  code?: string;
  /** Numeric HTTP-ish status, when the error carries one. */
  status?: number;
  /** Server-side stack trace (URL-credential scrubbed). */
  stack?: string;
}

function redactText(value: string): string {
  return redactUrlsInText(redactValue(value) as string);
}

function safeCode(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0 && value.length <= 200) {
    return redactText(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function safeStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Turns any thrown value into a safe, JSON-serializable object suitable for
 * structured logs. Include `includeStack: false` for contexts where a stack
 * trace is not wanted (defaults to true; stacks only ever reach server logs).
 */
export function serializeError(
  error: unknown,
  options: { includeStack?: boolean } = {},
): SerializedError {
  const includeStack = options.includeStack ?? true;

  if (error instanceof Error) {
    const withExtras = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const result: SerializedError = { name: error.name };

    if (error.message) {
      result.message = redactText(error.message);
    }
    const code = safeCode(withExtras.code);
    if (code !== undefined) {
      result.code = code;
    }
    const status = safeStatus(withExtras.status ?? withExtras.statusCode);
    if (status !== undefined) {
      result.status = status;
    }
    if (includeStack && typeof error.stack === "string") {
      result.stack = redactText(error.stack);
    }
    return result;
  }

  // Non-Error throwables (strings, numbers, plain objects) — never spread an
  // unknown object; stringify safely and redact.
  return {
    name: "NonError",
    message: redactText(typeof error === "string" ? error : String(error)),
  };
}
