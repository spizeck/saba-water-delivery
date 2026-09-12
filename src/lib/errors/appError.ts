/**
 * Canonical server error model for API boundaries and server logic.
 *
 * Three separate concerns are intentionally NOT collapsed (see
 * TECHNICAL.md "Server error handling"):
 *   1. Client-facing errors — the safe message/code/status returned here.
 *   2. Operational/security logs — structured Vercel telemetry (`@/lib/logging`).
 *   3. Business audit events — durable Firestore history.
 *
 * An `AppError` carries a machine-readable category, a client-safe HTTP status,
 * and an `isPublic` flag deciding whether its `message` may be shown to the
 * caller. Unknown/internal errors are never shown verbatim — the boundary
 * substitutes a generic message and keeps the original as `cause` for
 * redacted server-side logging only.
 *
 * Adapted from business-app-foundation's error model; the Prisma/Postgres
 * specifics are dropped since this app uses Firestore.
 */

export type AppErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "external_service"
  | "internal";

/** Stable client-facing error code for each category (the taxonomy). */
export const CATEGORY_CODE: Record<AppErrorCategory, string> = {
  validation: "VALIDATION_ERROR",
  authentication: "AUTHENTICATION_REQUIRED",
  authorization: "AUTHORIZATION_DENIED",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  rate_limit: "RATE_LIMITED",
  external_service: "EXTERNAL_SERVICE_ERROR",
  internal: "INTERNAL_ERROR",
};

const DEFAULT_STATUS: Record<AppErrorCategory, number> = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  not_found: 404,
  conflict: 409,
  rate_limit: 429,
  external_service: 502,
  internal: 500,
};

/** Generic message returned to clients for any non-public error. */
export const GENERIC_ERROR_MESSAGE =
  "An unexpected error occurred. Please try again later.";

export interface AppErrorOptions {
  statusCode?: number;
  /** The original underlying error, for redacted server-side logging only. */
  cause?: unknown;
  /** Whether `message` is safe to return to the client. */
  isPublic?: boolean;
  /** Overrides the category's default client code. */
  code?: string;
}

export class AppError extends Error {
  readonly category: AppErrorCategory;
  readonly code: string;
  readonly statusCode: number;
  readonly isPublic: boolean;

  constructor(
    category: AppErrorCategory,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = "AppError";
    this.category = category;
    this.code = options.code ?? CATEGORY_CODE[category];
    this.statusCode = options.statusCode ?? DEFAULT_STATUS[category];
    this.isPublic = options.isPublic ?? false;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// Client-safe by default: the message is intended for the caller. A caller can
// still pass isPublic:false to hide a specific message.
export class AppValidationError extends AppError {
  constructor(message = "Invalid request.", options: AppErrorOptions = {}) {
    super("validation", message, { isPublic: true, ...options });
    this.name = "AppValidationError";
  }
}

export class AppAuthenticationError extends AppError {
  constructor(
    message = "Authentication required.",
    options: AppErrorOptions = {},
  ) {
    super("authentication", message, { isPublic: true, ...options });
    this.name = "AppAuthenticationError";
  }
}

export class AppAuthorizationError extends AppError {
  constructor(message = "Permission denied.", options: AppErrorOptions = {}) {
    super("authorization", message, { isPublic: true, ...options });
    this.name = "AppAuthorizationError";
  }
}

export class AppNotFoundError extends AppError {
  constructor(message = "Not found.", options: AppErrorOptions = {}) {
    super("not_found", message, { isPublic: true, ...options });
    this.name = "AppNotFoundError";
  }
}

export class AppConflictError extends AppError {
  constructor(
    message = "The request conflicts with the current state.",
    options: AppErrorOptions = {},
  ) {
    super("conflict", message, { isPublic: true, ...options });
    this.name = "AppConflictError";
  }
}

export class AppRateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(
    message = "Too many requests. Please try again later.",
    retryAfterSeconds = 60,
    options: AppErrorOptions = {},
  ) {
    super("rate_limit", message, { isPublic: true, ...options });
    this.name = "AppRateLimitError";
    this.retryAfterSeconds = Math.max(0, Math.floor(retryAfterSeconds));
  }
}

// Not client-safe by default: provider/internal details must never reach the
// caller, so these default to the generic message.
export class AppExternalServiceError extends AppError {
  constructor(
    message = "A dependent service is unavailable.",
    options: AppErrorOptions = {},
  ) {
    super("external_service", message, { isPublic: false, ...options });
    this.name = "AppExternalServiceError";
  }
}

export class AppInternalError extends AppError {
  constructor(
    message = "Unexpected internal error.",
    options: AppErrorOptions = {},
  ) {
    super("internal", message, { isPublic: false, ...options });
    this.name = "AppInternalError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export { DEFAULT_STATUS };
