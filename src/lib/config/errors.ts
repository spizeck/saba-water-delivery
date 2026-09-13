/**
 * Configuration error type for the centralized configuration boundary
 * (issue #54).
 *
 * A `ConfigError` is thrown when a *required* configuration value is missing or
 * malformed at the point the application actually needs it. Its message names
 * the offending variable and the reason ONLY — it must NEVER contain the value
 * itself, because configuration values include secrets (Firebase private key,
 * Resend/WhatsApp/cron/rate-limit secrets). Callers may log a `ConfigError`
 * safely; the value never travels with it. See docs/adr/0016 and
 * `validators.ts`.
 */
export class ConfigError extends Error {
  /** The environment variable name (safe to surface). */
  readonly variable: string;
  /** Short, value-free reason (safe to surface). */
  readonly reason: string;

  constructor(variable: string, reason: string) {
    // The message is deliberately assembled from the variable NAME and a
    // categorical reason only — never the raw value.
    super(`${variable}: ${reason}`);
    this.name = "ConfigError";
    this.variable = variable;
    this.reason = reason;
  }
}

/** Type guard for callers that catch and want to branch on config failures. */
export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError;
}
