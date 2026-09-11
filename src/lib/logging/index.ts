/**
 * Canonical server-side observability toolkit.
 *
 * Usage:
 *   import { getLogger } from "@/lib/logging";
 *   const log = getLogger("domain.waterRequests");
 *   log.error("request.create.failed", { requestId, error: serializeError(err) });
 *
 * See docs/TECHNICAL.md ("Operational logging and observability") for the event
 * naming convention, the redaction policy, and the list of prohibited fields.
 * These are OPERATIONAL logs; durable business history lives in Firestore audit
 * events and is unaffected by this module.
 */

export {
  getLogger,
  withLogContext,
  getLogContext,
  generateId,
  Logger,
  type LogLevel,
  type LogContext,
} from "./logger";

export { serializeError, type SerializedError } from "./serializeError";

export { logSecurityEvent, SECURITY_EVENTS } from "./securityEvents";

export {
  extractRequestId,
  sanitizeRequestId,
  generateRequestId,
  setRequestIdHeader,
  REQUEST_ID_HEADER,
} from "./requestContext";

export {
  redactValue,
  redactObject,
  redactHeaders,
  redactUrlsInText,
} from "./redaction";
