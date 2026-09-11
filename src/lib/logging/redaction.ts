/**
 * Canonical redaction / sanitization layer for operational logging.
 *
 * This is a defense-in-depth safety net, NOT the primary privacy control.
 * The primary control is discipline at the call site: only ever pass
 * allowlisted, known-safe metadata to the logger (internal IDs, counts,
 * statuses, event outcomes) — never raw resident/customer objects, request
 * bodies, headers, cookies, provider response objects, or free text that may
 * contain personal data. When a field is ambiguous, do not log it.
 *
 * What this layer still guarantees, even if an unsafe value slips through:
 *   - Values under sensitive-looking keys (secrets, tokens, credentials, and
 *     personal fields like email/phone/name/directions/notes) are replaced
 *     with a placeholder.
 *   - Email addresses and international (`+`-prefixed) phone numbers embedded
 *     anywhere in a string value are masked.
 *   - URL credentials and query-string secrets are stripped.
 *   - Obvious secret-shaped strings (Bearer/Basic auth, PEM private keys) are
 *     replaced wholesale.
 *
 * Adapted from business-app-foundation's logging/redaction, extended with the
 * personal-data (PII) rules Saba Water Delivery requires.
 */

const REDACTED = "[REDACTED]";
const REDACTED_EMAIL = "[REDACTED_EMAIL]";
const REDACTED_PHONE = "[REDACTED_PHONE]";
const REDACTED_URL = "[REDACTED_URL]";
const TRUNCATED = "[TRUNCATED]";

/**
 * Object keys whose values must never be logged. Matched case-insensitively
 * against each key. Patterns are intentionally targeted so they do NOT clobber
 * safe operational identifiers (`requestId`, `customerId`, `driverId`,
 * `batchId`, `uid`, `pathname`, `sessionStep`, `event`, `component`).
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  // Secrets, tokens, and credentials.
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i, // idToken, accessToken, sessionToken, verifyToken, refreshToken
  /api[_-]?key/i,
  /apikey/i,
  /authorization/i,
  /^auth$/i,
  /cookie/i, // sessionCookie, set-cookie
  /private[_-]?key/i,
  /privatekey/i,
  /access[_-]?key/i,
  /credential/i,
  /service[_-]?account/i,
  /bearer/i,
  /signature/i, // x-hub-signature-256
  /\bhmac\b/i,
  // Personal data (PII).
  /email/i,
  /phone/i, // phone, senderPhone, recipientPhone, phoneNumber
  /mobile/i, // mobile, mobile_number, mobile-number, mobilePhone
  /\bmsisdn\b/i,
  /^name$/i,
  /display[_-]?name/i,
  /displayname/i,
  /full[_-]?name/i,
  /first[_-]?name/i,
  /last[_-]?name/i,
  /customer[_-]?name/i,
  /resident[_-]?name/i,
  /directions?/i, // deliveryDirections
  /\baddress\b/i,
  /\bnotes?\b/i, // requestNotes, note
  /requestnotes/i,
  /\bcomments?\b/i,
  /^customer$/i, // a customer snapshot object (customerId stays loggable)
  /customer[_-]?snapshot/i,
  /snapshot/i,
  /recipient/i,
];

/** Value prefixes that indicate the whole string is a secret. */
const SECRET_VALUE_PREFIXES: RegExp[] = [
  /^Bearer\s+/i,
  /^Basic\s+/i,
  /^-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+)?PRIVATE\s+KEY-----/i,
  /^-----BEGIN\s+CERTIFICATE-----/i,
];

const URL_SCHEMES_REQUIRING_CREDENTIAL_REDACTION =
  /^(?:https?|ftps?|redis|amqp|mongodb(?:\+srv)?):/i;

// Conservative PII value patterns. Email is low-false-positive. Phone is
// anchored on a leading "+" (E.164 / WhatsApp format, e.g. "+599 416 1234")
// so it does not mask long numeric IDs or epoch timestamps.
const EMAIL_VALUE_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_VALUE_PATTERN = /\+\d[\d\s().-]{6,}\d/g;

const MAX_STRING_LENGTH_FOR_SECRET_SCAN = 8192;
const MAX_REDACTION_DEPTH = 8;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function looksLikeSecretValue(value: string): boolean {
  if (value.length > MAX_STRING_LENGTH_FOR_SECRET_SCAN) {
    return false;
  }
  return SECRET_VALUE_PREFIXES.some((pattern) => pattern.test(value));
}

/** Masks email addresses and international phone numbers inside free text. */
function scrubPii(value: string): string {
  return value
    .replace(EMAIL_VALUE_PATTERN, REDACTED_EMAIL)
    .replace(PHONE_VALUE_PATTERN, REDACTED_PHONE);
}

function redactUrlCredentials(value: string): string {
  try {
    const url = new URL(value);

    for (const [key] of url.searchParams) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }

    // Build the string manually so the placeholder is not percent-encoded.
    const search = url.search;
    const pathname = url.pathname;
    const port = url.port ? `:${url.port}` : "";
    const host = `${url.hostname}${port}`;

    // Redact BOTH username and password. A username can itself be personal
    // data (e.g. an email address used as a login), so it must never survive.
    const credentials = url.username || url.password ? `${REDACTED}@` : "";

    // Scrub the rebuilt URL for any email/phone left in the path or query.
    return scrubPii(
      `${url.protocol}//${credentials}${host}${pathname}${search}`,
    );
  } catch {
    return REDACTED_URL;
  }
}

// Matches an Authorization Bearer/Basic credential wherever it appears in a
// string, so an embedded token in prose (e.g. a provider error message) is
// scrubbed while the surrounding text is preserved.
const EMBEDDED_AUTH_TOKEN_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

function redactAuthTokensInText(text: string): string {
  return text.replace(
    EMBEDDED_AUTH_TOKEN_PATTERN,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  );
}

function redactString(value: string): string {
  // A value that is entirely a secret (a PEM private key, or a bare
  // "Bearer <token>" / "Basic <token>") is dropped wholesale.
  if (looksLikeSecretValue(value)) {
    return REDACTED;
  }

  // Otherwise sanitize credentials that appear ANYWHERE in the string — not
  // only when the whole value is the URL or begins with the credential —
  // preserving the surrounding non-sensitive prose:
  //   1. credential-bearing URLs (username/password and secret query params),
  //   2. embedded Authorization Bearer/Basic tokens,
  //   3. email addresses and international phone numbers.
  const withoutUrlSecrets = redactUrlsInText(value);
  const withoutAuthTokens = redactAuthTokensInText(withoutUrlSecrets);
  return scrubPii(withoutAuthTokens);
}

function redactValueAtDepth(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return { type: value.name, message: redactString(value.message) };
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return TRUNCATED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValueAtDepth(item, depth + 1));
  }

  if (typeof value === "object") {
    return redactObjectAtDepth(value as Record<string, unknown>, depth + 1);
  }

  // Functions, symbols, and anything else are never logged verbatim.
  return REDACTED;
}

function redactObjectAtDepth(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redactValueAtDepth(value, depth);
    }
  }
  return result;
}

/** Redacts a single value of any type (recursively for objects/arrays). */
export function redactValue(value: unknown): unknown {
  return redactValueAtDepth(value, 0);
}

/** Redacts an object: sensitive keys wholesale, other values recursively. */
export function redactObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return redactObjectAtDepth(obj, 0);
}

/** Redacts an HTTP header bag (sensitive header names removed entirely). */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => redactString(v));
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Masks URL credentials/secrets embedded anywhere in free text. */
export function redactUrlsInText(text: string): string {
  return text.replace(/(\S+:\/\/[^\s]+)/g, (match) => {
    if (URL_SCHEMES_REQUIRING_CREDENTIAL_REDACTION.test(match)) {
      return redactUrlCredentials(match);
    }
    return match;
  });
}
