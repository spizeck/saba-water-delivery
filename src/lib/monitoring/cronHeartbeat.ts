import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger, serializeError } from "@/lib/logging";

/**
 * Scheduled-operation heartbeat (issue #62).
 *
 * The cron routes log richly when they run — but a cron that is never invoked
 * (misconfigured schedule, disabled cron, platform change) produces NOTHING:
 * no error, no log line, no signal. This module records a small
 * `cronHeartbeats/{name}` document on every run and lets the most frequent
 * cron (the notification worker, every 10 minutes) act as the watchdog that
 * detects staleness in itself and the other crons.
 *
 * Deliberately small: one document per cron, a stale-threshold check, and a
 * deduplicated `cron.heartbeat.stale` error log that any alert path can key
 * on. It is NOT a monitoring platform — external uptime checks, log-based
 * alerting, and Sentry rules are documented in docs/OPERATIONS.md.
 *
 * Privacy: heartbeat documents carry only operational metadata (timestamps,
 * status, failure count) — no request data, no recipients, no PII. The
 * collection is deny-by-default in Firestore rules (catch-all block) and is
 * written only by the Admin SDK in trusted cron code.
 */

const log = getLogger("monitoring.cronHeartbeat");

const HEARTBEAT_COLLECTION = "cronHeartbeats";

export interface CronExpectation {
  /** Human label for admin surfaces. */
  label: string;
  /** How often the cron is scheduled to run (informational). */
  schedule: string;
  /** lastSuccessAt older than this = stale → watchdog logs an alert event. */
  staleAfterMs: number;
}

/**
 * Registered crons and their staleness thresholds (grace on top of cadence).
 * Keep in sync with `vercel.json` schedules and
 * `scripts/check-cron-heartbeats.mjs`.
 */
export const CRON_EXPECTATIONS: Record<string, CronExpectation> = {
  "continuity-report": {
    label: "Nightly continuity report",
    schedule: "daily 00:00 UTC (vercel.json)",
    staleAfterMs: 27 * 60 * 60 * 1000, // daily + ~3h grace
  },
  notifications: {
    label: "Notification outbox worker",
    schedule: "every 10 minutes (vercel.json)",
    staleAfterMs: 60 * 60 * 1000, // 10-minute cadence + generous grace
  },
  "merge-auth-reconciliation": {
    label: "Merge Auth reconciliation sweep",
    schedule: "hourly at :37 (vercel.json)",
    staleAfterMs: 3 * 60 * 60 * 1000, // hourly + ~2h grace
  },
};

/** How often the watchdog may re-log a stale heartbeat (bounded noise). */
const STALE_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export type CronRunStatus = "success" | "failure";

/** Sanitized heartbeat document shape (Firestore Timestamp fields). */
export interface CronHeartbeatDoc {
  cron: string;
  lastAttemptAt?: { toDate(): Date };
  lastSuccessAt?: { toDate(): Date } | null;
  lastStatus?: CronRunStatus;
  consecutiveFailures?: number;
  lastStaleAlertAt?: { toDate(): Date } | null;
}

export interface CronHeartbeatStatus {
  cron: string;
  label: string;
  schedule: string;
  /** ISO timestamps or null when never recorded. */
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: CronRunStatus | null;
  consecutiveFailures: number;
  /** True when never succeeded or last success is beyond the threshold. */
  stale: boolean;
  ageMs: number | null;
}

/** Pure staleness evaluation — unit-testable core. */
export function evaluateHeartbeat(
  doc: CronHeartbeatDoc | null,
  expectation: CronExpectation,
  now: Date,
): { stale: boolean; ageMs: number | null } {
  const lastSuccessAt = doc?.lastSuccessAt?.toDate() ?? null;
  if (!lastSuccessAt) {
    // Never recorded a success — stale regardless of attempts.
    return { stale: true, ageMs: null };
  }
  const ageMs = now.getTime() - lastSuccessAt.getTime();
  return { stale: ageMs > expectation.staleAfterMs, ageMs };
}

function toStatus(
  cron: string,
  doc: CronHeartbeatDoc | null,
  now: Date,
): CronHeartbeatStatus {
  const expectation = CRON_EXPECTATIONS[cron];
  const { stale, ageMs } = evaluateHeartbeat(doc, expectation, now);
  return {
    cron,
    label: expectation.label,
    schedule: expectation.schedule,
    lastAttemptAt: doc?.lastAttemptAt?.toDate().toISOString() ?? null,
    lastSuccessAt: doc?.lastSuccessAt?.toDate().toISOString() ?? null,
    lastStatus: doc?.lastStatus ?? null,
    consecutiveFailures: doc?.consecutiveFailures ?? 0,
    stale,
    ageMs,
  };
}

/**
 * Records one cron run. Called at the END of the handler with the outcome so
 * an unauthorized request never touches heartbeat state, and a crash before
 * the handler body still leaves the last success timestamp visibly stale.
 *
 * Never throws — heartbeat bookkeeping must never break the cron it observes.
 */
export async function recordCronHeartbeat(
  cron: string,
  status: CronRunStatus,
  db?: Firestore,
): Promise<void> {
  try {
    const firestore = db ?? getAdminDb();
    await firestore
      .collection(HEARTBEAT_COLLECTION)
      .doc(cron)
      .set(
        {
          cron,
          lastAttemptAt: FieldValue.serverTimestamp(),
          lastStatus: status,
          consecutiveFailures:
            status === "success" ? 0 : FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          ...(status === "success"
            ? { lastSuccessAt: FieldValue.serverTimestamp() }
            : {}),
        },
        { merge: true },
      );
  } catch (error) {
    log.warn("cron.heartbeat.record_failed", {
      cron,
      error: serializeError(error),
    });
  }
}

/**
 * Watchdog pass over every registered cron: logs a deduplicated
 * `cron.heartbeat.stale` ERROR for any cron whose last success is missing or
 * older than its threshold, and stamps `lastStaleAlertAt` so the event
 * repeats at most every few hours while the cron stays silent.
 *
 * Runs inside the most frequent cron (the notification worker). If THAT cron
 * itself goes silent, its own heartbeat doc goes stale — visible on
 * `/admin/notifications` and via `npm run check:heartbeats`; external uptime
 * monitoring of `/api/health` is the last line (docs/OPERATIONS.md).
 */
export async function runCronWatchdog(
  now: Date = new Date(),
  db?: Firestore,
): Promise<CronHeartbeatStatus[]> {
  let firestore: Firestore;
  try {
    firestore = db ?? getAdminDb();
  } catch (error) {
    log.warn("cron.heartbeat.read_failed", {
      error: serializeError(error),
    });
    return [];
  }
  const statuses: CronHeartbeatStatus[] = [];
  for (const cron of Object.keys(CRON_EXPECTATIONS)) {
    let doc: CronHeartbeatDoc | null = null;
    try {
      const snap = await firestore
        .collection(HEARTBEAT_COLLECTION)
        .doc(cron)
        .get();
      doc = snap.exists ? (snap.data() as CronHeartbeatDoc) : null;
    } catch (error) {
      log.warn("cron.heartbeat.read_failed", {
        cron,
        error: serializeError(error),
      });
      continue;
    }

    const status = toStatus(cron, doc, now);
    statuses.push(status);
    if (!status.stale) continue;

    const lastAlertAt = doc?.lastStaleAlertAt?.toDate() ?? null;
    if (
      lastAlertAt &&
      now.getTime() - lastAlertAt.getTime() < STALE_ALERT_COOLDOWN_MS
    ) {
      continue;
    }
    log.error("cron.heartbeat.stale", {
      cron,
      lastSuccessAt: status.lastSuccessAt,
      lastStatus: status.lastStatus,
      consecutiveFailures: status.consecutiveFailures,
      staleAfterMs: CRON_EXPECTATIONS[cron].staleAfterMs,
    });
    try {
      await firestore
        .collection(HEARTBEAT_COLLECTION)
        .doc(cron)
        .set(
          { cron, lastStaleAlertAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
    } catch (error) {
      log.warn("cron.heartbeat.alert_stamp_failed", {
        cron,
        error: serializeError(error),
      });
    }
  }
  return statuses;
}

/**
 * Admin-surface read: staleness status for every registered cron. Read-only,
 * sanitized — no error text or internals beyond categorical status.
 */
export async function getCronHeartbeatStatuses(
  now: Date = new Date(),
  db?: Firestore,
): Promise<CronHeartbeatStatus[]> {
  let firestore: Firestore;
  try {
    firestore = db ?? getAdminDb();
  } catch (error) {
    log.warn("cron.heartbeat.read_failed", {
      error: serializeError(error),
    });
    return [];
  }
  const statuses: CronHeartbeatStatus[] = [];
  for (const cron of Object.keys(CRON_EXPECTATIONS)) {
    try {
      const snap = await firestore
        .collection(HEARTBEAT_COLLECTION)
        .doc(cron)
        .get();
      statuses.push(
        toStatus(
          cron,
          snap.exists ? (snap.data() as CronHeartbeatDoc) : null,
          now,
        ),
      );
    } catch (error) {
      log.warn("cron.heartbeat.read_failed", {
        cron,
        error: serializeError(error),
      });
      statuses.push({
        cron,
        label: CRON_EXPECTATIONS[cron].label,
        schedule: CRON_EXPECTATIONS[cron].schedule,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 0,
        stale: true,
        ageMs: null,
      });
    }
  }
  return statuses;
}
