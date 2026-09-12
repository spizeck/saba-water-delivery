/**
 * Canonical server error model and API error responses.
 *
 * See TECHNICAL.md "Server error handling" for the architecture, the error-code
 * taxonomy, the client-safe response shape, and boundary logging ownership.
 */

export {
  AppError,
  AppValidationError,
  AppAuthenticationError,
  AppAuthorizationError,
  AppNotFoundError,
  AppConflictError,
  AppRateLimitError,
  AppExternalServiceError,
  AppInternalError,
  isAppError,
  CATEGORY_CODE,
  GENERIC_ERROR_MESSAGE,
  type AppErrorCategory,
  type AppErrorOptions,
} from "./appError";

export { normalizeError, buildServerErrorContext } from "./normalize";

export {
  buildApiErrorResponse,
  buildClientErrorBody,
  type ClientErrorBody,
} from "./apiResponse";
