import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { redactObject, redactUrlsInText, redactValue } from "./redaction";

/**
 * Canonical server-side structured logger for Saba Water Delivery.
 *
 * Emits one JSON line per entry (Vercel captures stdout/stderr), with a stable
 * event name, request/correlation IDs from the ambient context, and redacted
 * metadata. The event name is the first argument (e.g. "request.create.failed")
 * and doubles as the log message.
 *
 * This is OPERATIONAL telemetry only. It is deliberately separate from, and
 * never a replacement for, the durable business audit events written to
 * Firestore (see docs/TECHNICAL.md) — those remain the authoritative history.
 *
 * Fail-safe: a logging failure can never throw into a caller, so core
 * water-delivery operations (request creation, dispatch, delivery state,
 * webhook processing) are never behind logging success.
 *
 * Adapted from business-app-foundation's logging/logger.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  actorRole?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  component: string;
  env: string;
  requestId?: string;
  correlationId?: string;
  actorRole?: string;
  [key: string]: unknown;
}

const logStorage = new AsyncLocalStorage<LogContext>();

/** Returns the ambient log context (request/correlation IDs), or an empty one. */
export function getLogContext(): LogContext {
  return logStorage.getStore() ?? {};
}

/** Runs `fn` with `context` merged into the ambient log context. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const current = getLogContext();
  return logStorage.run({ ...current, ...context }, fn);
}

/** Generates a non-identifying random correlation/request ID. */
export function generateId(): string {
  return randomUUID();
}

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_PRIORITY;
}

/**
 * Minimum level that is emitted. Controlled by the optional `LOG_LEVEL`
 * environment variable; defaults to "info" in production and "debug"
 * otherwise. `LOG_LEVEL` is never required for the app to run.
 */
function minimumLogLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && isLogLevel(configured)) {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function buildEntry(
  level: LogLevel,
  component: string,
  event: string,
  extra: Record<string, unknown>,
): LogEntry {
  const context = getLogContext();
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    component,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    requestId: context.requestId,
    correlationId: context.correlationId,
    actorRole: context.actorRole,
    ...extra,
  };
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeEntry(entry: LogEntry): Record<string, unknown> {
  const {
    timestamp,
    level,
    event,
    component,
    env,
    requestId,
    correlationId,
    actorRole,
    ...extra
  } = entry;

  // Standard fields are known-safe (IDs, level, env, event name). Only the
  // caller-supplied `extra` is passed through the redaction net.
  return stripUndefined({
    timestamp,
    level,
    event: redactUrlsInText(redactValue(event) as string),
    component,
    env,
    requestId,
    correlationId,
    actorRole,
    ...redactObject(extra),
  });
}

function safeStringify(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      timestamp: entry.timestamp,
      level: entry.level,
      event: entry.event,
      component: entry.component,
      error: "log_serialization_failed",
    });
  }
}

function emit(level: LogLevel, line: string): void {
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export class Logger {
  constructor(private readonly component: string) {}

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minimumLogLevel()];
  }

  private log(
    level: LogLevel,
    event: string,
    extra: Record<string, unknown> = {},
  ): void {
    // Never let logging throw into the caller. A logging failure must not
    // break request creation, dispatch, delivery state, or webhook handling.
    try {
      if (!this.shouldLog(level)) {
        return;
      }
      const entry = buildEntry(level, this.component, event, extra);
      emit(level, safeStringify(sanitizeEntry(entry)));
    } catch {
      try {
        console.error(
          JSON.stringify({
            level: "error",
            component: this.component,
            event: "logger_failed",
          }),
        );
      } catch {
        // Give up silently rather than propagate a logging error.
      }
    }
  }

  debug(event: string, extra?: Record<string, unknown>): void {
    this.log("debug", event, extra);
  }

  info(event: string, extra?: Record<string, unknown>): void {
    this.log("info", event, extra);
  }

  warn(event: string, extra?: Record<string, unknown>): void {
    this.log("warn", event, extra);
  }

  error(event: string, extra?: Record<string, unknown>): void {
    this.log("error", event, extra);
  }
}

/** Returns a logger bound to a component name (e.g. "api.webhooks.whatsapp"). */
export function getLogger(component: string): Logger {
  return new Logger(component);
}
