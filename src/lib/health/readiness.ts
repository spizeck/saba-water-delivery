import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger, serializeError } from "@/lib/logging";

/**
 * Readiness evaluation for the operational health surface (issue #33).
 *
 * Readiness answers a single question for operators and deployment tooling:
 * **can the app perform its core government water-delivery service right now?**
 * That core service depends on Firebase Admin / Firestore, so readiness is
 * determined ONLY by whether a minimal Firestore access succeeds. Optional,
 * gracefully-degrading integrations (Resend email, WhatsApp/Meta, Firebase
 * Storage, PDF generation, the rate limiter) deliberately do NOT influence
 * readiness — an outage in any of them must not make a still-serving app look
 * unready. See TECHNICAL.md "Health and readiness endpoints".
 *
 * This is OPERATIONAL infrastructure. It never reads resident/customer data,
 * never writes to Firestore, and never returns provider errors, exception
 * messages, stack traces, secrets, or configuration to the caller — only a
 * stable categorical status. Failures are logged (sanitized via
 * `serializeError`) through the existing structured logger.
 */

const log = getLogger("api.readiness");

/** A single dependency's coarse, client-safe state. */
export type CheckStatus = "ok" | "unavailable";

/** Overall readiness verdict. */
export type ReadinessStatus = "ready" | "not_ready";

export interface ReadinessResult {
  status: ReadinessStatus;
  checks: {
    /** The Next.js route/runtime is executing — always `ok` if we got here. */
    app: CheckStatus;
    /** Firebase Admin / Firestore connectivity. Determines readiness. */
    firestore: CheckStatus;
  };
  /** 200 when ready, 503 when a readiness-critical dependency is unavailable. */
  httpStatus: 200 | 503;
}

/**
 * Dedicated, NON-business Firestore path used purely to prove connectivity. It
 * is never written to, so the collection never materializes in Firestore and
 * carries no domain data — reading it can never touch or expose resident
 * records, and there is no coupling to any business collection. The document is
 * not expected to exist; a successful "not found" read still proves that Admin
 * credentials are valid and Firestore is reachable.
 */
const READINESS_PROBE_COLLECTION = "_health";
const READINESS_PROBE_DOCUMENT = "probe";

/**
 * Upper bound on the readiness probe so an unreachable or slow Firestore yields
 * `not_ready` quickly instead of hanging the request (and any uptime monitor
 * behind it). The probe itself is a single indexed document read, so under
 * normal conditions it returns in well under this budget.
 */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Rejects if `promise` does not settle within `ms`. Used to bound the Firestore
 * probe. The timer is always cleared so a resolved probe never leaves a dangling
 * timeout that could keep the serverless function alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("readiness_probe_timeout"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The default, production Firestore readiness probe: a single READ of a
 * dedicated non-business document, bounded by {@link PROBE_TIMEOUT_MS}.
 *
 * - `getAdminDb()` throws synchronously when Firebase Admin is missing or
 *   malformed, so a bad/absent production configuration surfaces here as a
 *   caught failure → `not_ready` (never a raw init error to the caller).
 * - `.get()` is read-only; no `set`/`add`/`update`/`delete` is ever issued, so
 *   the probe cannot create or mutate data.
 */
async function defaultFirestoreProbe(): Promise<void> {
  const db = getAdminDb();
  await withTimeout(
    db
      .collection(READINESS_PROBE_COLLECTION)
      .doc(READINESS_PROBE_DOCUMENT)
      .get(),
    PROBE_TIMEOUT_MS,
  );
}

export interface EvaluateReadinessOptions {
  /**
   * Override the Firestore probe. TEST-ONLY seam — production always uses the
   * default read-only, timeout-bounded probe.
   */
  probeFirestore?: () => Promise<void>;
}

/**
 * Runs the readiness checks and returns a client-safe result. Never throws:
 * any probe failure is caught, logged (sanitized), and reported as the coarse
 * `firestore: "unavailable"` state with a 503.
 */
export async function evaluateReadiness(
  options: EvaluateReadinessOptions = {},
): Promise<ReadinessResult> {
  const firestore = await checkFirestore(
    options.probeFirestore ?? defaultFirestoreProbe,
  );
  const ready = firestore === "ok";

  return {
    status: ready ? "ready" : "not_ready",
    checks: { app: "ok", firestore },
    httpStatus: ready ? 200 : 503,
  };
}

async function checkFirestore(
  probe: () => Promise<void>,
): Promise<CheckStatus> {
  try {
    await probe();
    return "ok";
  } catch (error) {
    // Meaningful failure — log it once, at error level, so it is visible even
    // under production's info log level (routine successful probes stay quiet).
    // Only safe metadata leaves this module: the check name and a sanitized
    // error. The raw provider/exception text never reaches the HTTP response.
    log.error("health.readiness.failed", {
      check: "firestore",
      error: serializeError(error),
    });
    return "unavailable";
  }
}
