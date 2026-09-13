import "server-only";

import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger, serializeError } from "@/lib/logging";

import { sendDeliveryConfirmationFromOutbox } from "./deliveryConfirmationSender";
import {
  NOTIFICATION_OUTBOX_COLLECTION,
  type OutboxRecord,
  toOutboxRecord,
} from "./outbox";
import {
  decideAfterFailure,
  LEASE_DURATION_MS,
  type SendOutcome,
  WORKER_BATCH_LIMIT,
} from "./outboxPolicy";

const log = getLogger("notifications.outbox");

/**
 * Durable notification outbox WORKER (issue #53).
 *
 * A bounded pass that: (1) claims a bounded set of eligible notifications with a
 * Firestore lease transaction, (2) sends each OUTSIDE any transaction (never
 * holding a transaction open across a Resend call), and (3) records the outcome
 * in a second transaction guarded by lease ownership. Safe to invoke at any
 * cadence (protected cron, manual curl, or an external scheduler) and safe to
 * run concurrently — an active lease prevents a second worker from sending the
 * same notification, and an expired lease (a crashed worker) is reclaimable.
 *
 * Sending is injectable (`options.send`) so retry/lease/idempotency behavior can
 * be tested against the emulator with a fake provider; production uses the real
 * per-type sender.
 */

export type NotificationSender = (record: OutboxRecord) => Promise<SendOutcome>;

async function defaultSender(record: OutboxRecord): Promise<SendOutcome> {
  switch (record.type) {
    case "delivery_confirmation_email":
      return sendDeliveryConfirmationFromOutbox(record);
    default:
      return {
        status: "failed",
        category: "permanent",
        reason: "unknown_notification_type",
      };
  }
}

export interface ProcessOutboxOptions {
  /** Epoch ms treated as "now" (injected for deterministic tests). */
  now?: number;
  /** Max notifications processed this pass (default {@link WORKER_BATCH_LIMIT}). */
  limit?: number;
  /** Opaque worker-run id used as the lease owner (default random). */
  leaseOwner?: string;
  /** Injected provider sender (default: the real per-type sender). */
  send?: NotificationSender;
  /** Injected RNG for backoff jitter (default `Math.random`). */
  rng?: () => number;
}

export interface ProcessOutboxResult {
  scanned: number;
  claimed: number;
  sent: number;
  retried: number;
  terminal: number;
  skipped: number;
}

export async function processNotificationOutbox(
  options: ProcessOutboxOptions = {},
): Promise<ProcessOutboxResult> {
  const db = getAdminDb();
  const nowMs = options.now ?? Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);
  const limit = options.limit ?? WORKER_BATCH_LIMIT;
  const leaseOwner = options.leaseOwner ?? randomUUID();
  const send = options.send ?? defaultSender;
  const rng = options.rng ?? Math.random;
  const col = db.collection(NOTIFICATION_OUTBOX_COLLECTION);

  // Candidates: pending-and-due, plus processing whose lease has expired (a
  // crashed worker's abandoned work). Both queries are bounded and ordered.
  const [pendingSnap, expiredSnap] = await Promise.all([
    col
      .where("state", "==", "pending")
      .where("nextAttemptAt", "<=", nowTs)
      .orderBy("nextAttemptAt", "asc")
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get(),
    col
      .where("state", "==", "processing")
      .where("leaseExpiresAt", "<=", nowTs)
      .orderBy("leaseExpiresAt", "asc")
      .limit(limit)
      .get(),
  ]);

  // Interleave expired-lease and pending-due candidates so a sustained pending
  // backlog can never STARVE crashed-worker recovery: a notification abandoned
  // by a crashed worker (expired `processing` lease) would otherwise never be
  // reclaimed while at least `limit` pending records are always due. Expired
  // leases are placed first in each pair to slightly favor recovery.
  const candidateIds: string[] = [];
  const seen = new Set<string>();
  const expired = expiredSnap.docs;
  const pending = pendingSnap.docs;
  for (
    let i = 0;
    candidateIds.length < limit && (i < expired.length || i < pending.length);
    i++
  ) {
    for (const doc of [expired[i], pending[i]]) {
      if (!doc || seen.has(doc.id)) continue;
      seen.add(doc.id);
      candidateIds.push(doc.id);
      if (candidateIds.length >= limit) break;
    }
  }

  const result: ProcessOutboxResult = {
    scanned: candidateIds.length,
    claimed: 0,
    sent: 0,
    retried: 0,
    terminal: 0,
    skipped: 0,
  };

  for (const id of candidateIds) {
    const ref = col.doc(id);

    // 1) Claim (transactional lease). Re-checks eligibility inside the txn so a
    // notification another worker already claimed (active lease) is skipped.
    const claimedRecord = await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return null;
      const data = snap.data()!;
      const nextAttemptMs = data.nextAttemptAt?.toMillis?.() ?? Infinity;
      const leaseExpiresMs = data.leaseExpiresAt?.toMillis?.() ?? Infinity;
      const eligible =
        (data.state === "pending" && nextAttemptMs <= nowMs) ||
        (data.state === "processing" && leaseExpiresMs <= nowMs);
      if (!eligible) return null;
      txn.update(ref, {
        state: "processing",
        leaseOwner,
        leaseExpiresAt: Timestamp.fromMillis(nowMs + LEASE_DURATION_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return toOutboxRecord(id, data);
    });

    if (!claimedRecord) {
      result.skipped++;
      continue;
    }
    result.claimed++;

    // 2) Send OUTSIDE any transaction. A thrown sender is a transient failure.
    let outcome: SendOutcome;
    try {
      outcome = await send(claimedRecord);
    } catch (err) {
      log.error("notifications.outbox.sender_threw", {
        notificationId: id,
        notificationType: claimedRecord.type,
        requestId: claimedRecord.requestId,
        error: serializeError(err),
      });
      outcome = {
        status: "failed",
        category: "transient",
        reason: "sender_threw",
      };
    }

    // 3) Record the outcome (transactional; only if we still own the lease, so a
    // reclaiming worker's newer state is never clobbered by a slow original).
    const recorded = await db.runTransaction<
      "sent" | "retried" | "terminal" | "skipped"
    >(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return "skipped";
      const data = snap.data()!;
      if (data.state !== "processing" || data.leaseOwner !== leaseOwner) {
        return "skipped";
      }
      const attemptCount =
        (typeof data.attemptCount === "number" ? data.attemptCount : 0) + 1;
      const base = {
        attemptCount,
        lastAttemptAt: FieldValue.serverTimestamp(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (outcome.status === "sent") {
        txn.update(ref, {
          ...base,
          state: "sent",
          sentAt: FieldValue.serverTimestamp(),
          providerMessageId: outcome.providerMessageId,
          failureCategory: null,
          failureReason: null,
        });
        return "sent";
      }

      const decision = decideAfterFailure(attemptCount, outcome.category, rng);
      if (decision.state === "pending") {
        txn.update(ref, {
          ...base,
          state: "pending",
          nextAttemptAt: Timestamp.fromMillis(
            nowMs + (decision.retryDelayMs ?? 0),
          ),
          failureCategory: decision.category,
          failureReason: outcome.reason,
        });
        return "retried";
      }
      txn.update(ref, {
        ...base,
        state: "failed",
        failureCategory: decision.category,
        failureReason: outcome.reason,
      });
      return "terminal";
    });

    if (recorded === "sent") result.sent++;
    else if (recorded === "retried") result.retried++;
    else if (recorded === "terminal") result.terminal++;
    else result.skipped++;
  }

  // Aggregate counts only — never notification contents or recipient PII.
  log.info("notifications.outbox.processed", { ...result });
  return result;
}
