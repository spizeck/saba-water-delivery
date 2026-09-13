import "server-only";

import { createHmac } from "node:crypto";

import {
  FieldValue,
  type Firestore,
  Timestamp,
} from "firebase-admin/firestore";
import type { NextRequest } from "next/server";

import { isDeployedVercel } from "@/lib/config/deployment";
import { AppRateLimitError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";

/**
 * Centralized, server-side rate limiting for abuse-sensitive operations.
 *
 * This is a SECURITY control (defense in depth against automated abuse of
 * public/semi-public mutations), deliberately kept separate from the app's
 * business-domain limits — driver decline cooldowns, duplicate active-request
 * prevention, Firestore transaction guards, and webhook idempotency remain the
 * authoritative rules and are NOT replaced by this limiter.
 *
 * Storage: Firestore (the app's existing infrastructure) via atomic
 * transactions, so the window count is correct across multiple Vercel
 * serverless instances — an in-memory Map would not be. Each key is one small
 * document that is reused across windows and expires via TTL (see
 * docs/DEPLOYMENT.md). See TECHNICAL.md "Rate limiting" for the full design.
 *
 * Algorithm: fixed window — the simplest correct model at Saba's scale.
 * Time source: the server (`Date.now()`), never a client-supplied timestamp.
 *
 * Fail-open: a limiter/storage outage logs an operational event and ALLOWS the
 * request. The limiter must never become a new availability dependency that
 * turns a Firestore blip into a water-delivery outage.
 */

const log = getLogger("security.rate-limit");

const COLLECTION = "rateLimits";

// Keys are HMAC-hashed with a server secret so a raw identifier (especially a
// small-space value like an IP) is never stored and cannot be reversed from the
// document ID. In DEPLOYED environments (Vercel Production/Preview) a real
// RATE_LIMIT_HASH_SECRET is REQUIRED — this repository is public, so a
// repo-known static salt would NOT prevent precomputation/dictionary recovery
// of an IP. The fallback below is deterministic and used ONLY locally / in
// tests (VERCEL_ENV unset) so contributors and the emulator need no production
// secret; it is not a production privacy control. See docs/DEPLOYMENT.md.
const LOCAL_DEV_HASH_SALT = "saba-water-delivery/rate-limit/local-dev-only/v1";

// Kept in Firestore after the window ends only so a TTL policy can reclaim the
// document; correctness never depends on physical cleanup (an expired window is
// treated as fresh on the next read regardless of whether TTL has run yet).
const RETENTION_AFTER_RESET_MS = 24 * 60 * 60 * 1000; // 24h

export interface RateLimitPolicy {
  /** Maximum operations allowed within the window. */
  limit: number;
  /** Fixed-window duration in milliseconds. */
  windowMs: number;
  /** Maintainer-facing note on what this policy protects. */
  description: string;
}

/**
 * Named policies with conservative, Saba-appropriate defaults. These are safe
 * to keep in source (they are security policy, not secrets) and are the ONE
 * place thresholds live — adjust here, no route changes needed.
 */
export const RATE_LIMIT_POLICIES = {
  // Pre-auth, public endpoint (`POST /api/auth/session`). Keyed by IP. Normal
  // sign-in is one request; this stops automated credential stuffing while
  // staying generous for many users behind one shared island ISP address.
  "auth-session": {
    limit: 50,
    windowMs: 5 * 60 * 1000,
    description: "Session establishment (POST /api/auth/session), per IP.",
  },
  // Resident water-request creation, keyed by UID. A resident can only hold one
  // active request (a business rule that remains authoritative); this is purely
  // abuse protection against rapid-fire submission attempts.
  "request-create": {
    limit: 10,
    windowMs: 10 * 60 * 1000,
    description: "Resident water-request submission, per authenticated UID.",
  },
  // Delivery confirm/dispute actions, keyed by UID. The request state machine
  // remains authoritative; this guards against automated repeated submissions.
  "delivery-response": {
    limit: 20,
    windowMs: 10 * 60 * 1000,
    description: "Delivery confirmation/dispute, per authenticated UID.",
  },
  // Resident self-service request cancellation, keyed by UID. The request
  // state machine and its transaction guard remain authoritative; this
  // guards against automated repeated cancellation attempts.
  "request-cancel": {
    limit: 20,
    windowMs: 10 * 60 * 1000,
    description: "Resident request cancellation, per authenticated UID.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/** How the caller is identified. The raw `value` is never stored or logged. */
export type RateLimitIdentifierType =
  "uid" | "ip" | "actor" | "whatsapp_sender";

export interface RateLimitIdentifier {
  type: RateLimitIdentifierType;
  /** The raw identifier; `null`/empty skips limiting (e.g. no trusted IP). */
  value: string | null | undefined;
}

export interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

/** Storage backend. Production uses Firestore; tests may inject their own. */
export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitEntry>;
}

export interface RateLimitDecision {
  allowed: boolean;
  policy: RateLimitPolicyName;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
  /** False when the check was skipped (no identifier) or failed open. */
  enforced: boolean;
}

/**
 * Firestore-backed fixed-window store. Uses a transaction so simultaneous
 * requests for the same key cannot all read a stale count and bypass the limit.
 */
export class FirestoreRateLimitStore implements RateLimitStore {
  // Injectable for emulator-backed tests; production uses the Admin SDK db.
  constructor(private readonly db: Firestore = getAdminDb()) {}

  async increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitEntry> {
    const ref = this.db.collection(COLLECTION).doc(key);

    return this.db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      const data = snap.exists ? snap.data() : undefined;

      const priorReset =
        typeof data?.resetAtMs === "number" ? data.resetAtMs : 0;
      const priorCount = typeof data?.count === "number" ? data.count : 0;

      let count: number;
      let windowStartMs: number;
      let resetAtMs: number;

      if (!data || priorReset <= nowMs) {
        // No document, or the previous window has elapsed — start fresh. An
        // expired window is reset here even if TTL has not yet deleted the doc.
        count = 1;
        windowStartMs = nowMs;
        resetAtMs = nowMs + windowMs;
      } else {
        count = priorCount + 1;
        windowStartMs =
          typeof data.windowStartMs === "number" ? data.windowStartMs : nowMs;
        resetAtMs = priorReset;
      }

      txn.set(ref, {
        count,
        windowStartMs,
        resetAtMs,
        // For TTL cleanup only (configure a TTL policy on `expiresAt`).
        expiresAt: Timestamp.fromMillis(resetAtMs + RETENTION_AFTER_RESET_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { count, resetAtMs };
    });
  }
}

/**
 * In-memory store — TEST ONLY. It is process-local and therefore NOT safe as a
 * production backend across serverless instances; production always uses
 * {@link FirestoreRateLimitStore}.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitEntry>();

  async increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitEntry> {
    const existing = this.entries.get(key);
    if (existing && existing.resetAtMs > nowMs) {
      existing.count += 1;
      return { ...existing };
    }
    const entry: RateLimitEntry = { count: 1, resetAtMs: nowMs + windowMs };
    this.entries.set(key, entry);
    return { ...entry };
  }
}

let defaultStore: RateLimitStore | null = null;

function getDefaultStore(): RateLimitStore {
  if (!defaultStore) {
    defaultStore = new FirestoreRateLimitStore();
  }
  return defaultStore;
}

/** True on Vercel Production/Preview — where a real secret is mandatory.
 * Sourced from the centralized deployment helper (issue #54) so this and the
 * Firebase admin emulator guard agree on what "deployed" means. */
function isDeployedVercelEnv(): boolean {
  return isDeployedVercel();
}

type SecretResolution = { secret: string } | { missing: true };

/**
 * Resolves the HMAC secret. A configured `RATE_LIMIT_HASH_SECRET` always wins.
 * When it is absent, a DEPLOYED environment reports `missing` (the caller then
 * treats the limiter as unavailable and fails open — it never hashes with the
 * public static salt); local/test environments use the deterministic
 * development-only fallback.
 */
function resolveHashSecret(): SecretResolution {
  const configured = process.env.RATE_LIMIT_HASH_SECRET?.trim();
  if (configured && configured.length > 0) {
    return { secret: configured };
  }
  if (isDeployedVercelEnv()) {
    return { missing: true };
  }
  return { secret: LOCAL_DEV_HASH_SALT };
}

function normalizeIdentifierValue(identifier: RateLimitIdentifier): string {
  const raw = (identifier.value ?? "").trim();
  // IPs are case-folded (IPv6 hex); other identifiers are opaque.
  return identifier.type === "ip" ? raw.toLowerCase() : raw;
}

/** Derives the opaque, non-reversible Firestore document id for a bucket. */
function deriveKey(
  policy: RateLimitPolicyName,
  identifier: RateLimitIdentifier,
  secret: string,
): string {
  const material = `${policy}:${identifier.type}:${normalizeIdentifierValue(identifier)}`;
  return createHmac("sha256", secret).update(material).digest("hex");
}

/**
 * The client IP as trusted by Vercel's edge — the leftmost `x-forwarded-for`
 * entry (fallback `x-real-ip`). Only trusted when running behind Vercel
 * (`VERCEL_ENV` set); locally/in tests it returns `null` so a spoofed
 * forwarding header cannot mint unlimited identities and IP limiting is simply
 * inactive. The raw IP is only ever used to build the HMAC key — never stored
 * or logged.
 */
export function getTrustedClientIp(request: NextRequest): string | null {
  if (!process.env.VERCEL_ENV) {
    return null;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) {
    return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Checks (and increments) the rate-limit bucket for `identifier` under
 * `policyName`. Never throws: on a storage failure it fails OPEN (logs and
 * allows); on rejection it logs a `security.rate_limit.exceeded` event with
 * safe metadata only (policy, identifier TYPE, timing) — never the raw
 * identifier. Server actions can inspect the returned decision; HTTP routes
 * should use {@link enforceRateLimit}.
 */
export async function checkRateLimit(
  policyName: RateLimitPolicyName,
  identifier: RateLimitIdentifier,
  options: { store?: RateLimitStore; now?: number } = {},
): Promise<RateLimitDecision> {
  const policy = RATE_LIMIT_POLICIES[policyName];
  const now = options.now ?? Date.now();

  const base = {
    policy: policyName,
    limit: policy.limit,
    remaining: policy.limit,
    resetAtMs: now + policy.windowMs,
    retryAfterSeconds: 0,
  };

  // No usable identifier (e.g. no trusted IP in dev) — skip silently.
  if (!identifier.value || identifier.value.trim() === "") {
    return { ...base, allowed: true, enforced: false };
  }

  const secretResolution = resolveHashSecret();
  if ("missing" in secretResolution) {
    // Deployed without the required secret. We refuse to hash identifiers with
    // the public static salt, so the limiter is unavailable — fail open (allow)
    // and log loudly so the misconfiguration is fixed. This never blocks
    // auth/water-delivery availability just because config is missing.
    log.error("rate_limit.secret_missing", {
      policy: policyName,
      identifierType: identifier.type,
      vercelEnv: process.env.VERCEL_ENV,
    });
    return { ...base, allowed: true, enforced: false };
  }

  const store = options.store ?? getDefaultStore();
  const key = deriveKey(policyName, identifier, secretResolution.secret);

  let entry: RateLimitEntry;
  try {
    entry = await store.increment(key, policy.windowMs, now);
  } catch (error) {
    // Fail open — a limiter outage must not break the underlying operation.
    log.error("rate_limit.storage_unavailable", {
      policy: policyName,
      identifierType: identifier.type,
      error: serializeError(error),
    });
    return { ...base, allowed: true, enforced: false };
  }

  const remaining = Math.max(0, policy.limit - entry.count);
  const allowed = entry.count <= policy.limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((entry.resetAtMs - now) / 1000));

  if (!allowed) {
    logSecurityEvent(SECURITY_EVENTS.rateLimitExceeded, {
      policy: policyName,
      identifierType: identifier.type,
      retryAfterSeconds,
      // uid is an opaque internal ID and safe to log; other identifier values
      // (IP, sender) are never logged.
      ...(identifier.type === "uid" ? { uid: identifier.value } : {}),
    });
  }

  return {
    allowed,
    policy: policyName,
    limit: policy.limit,
    remaining,
    resetAtMs: entry.resetAtMs,
    retryAfterSeconds,
    enforced: true,
  };
}

/**
 * Rate-limit guard for HTTP routes: throws `AppRateLimitError` (→ 429,
 * `RATE_LIMITED`, `Retry-After`, correlated request id via `withApiRoute`) when
 * the limit is exceeded. Returns the decision otherwise.
 */
export async function enforceRateLimit(
  policyName: RateLimitPolicyName,
  identifier: RateLimitIdentifier,
  options: { store?: RateLimitStore; now?: number } = {},
): Promise<RateLimitDecision> {
  const decision = await checkRateLimit(policyName, identifier, options);
  if (!decision.allowed) {
    throw new AppRateLimitError(
      "Too many requests. Please wait a moment and try again.",
      decision.retryAfterSeconds,
    );
  }
  return decision;
}
