import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { NOTIFICATION_OUTBOX_COLLECTION } from "./outbox";
import type { NotificationState, NotificationType } from "./outboxPolicy";

/**
 * Admin/operator read + manual-retry surface for the durable notification
 * outbox (issue #53). Server-only, called from admin-guarded server actions and
 * server components (`requireRole("admin")`). Every entry is SANITIZED — opaque
 * ids and non-PII state/timing only; never the recipient email, message body,
 * provider payload, or any secret.
 */

/** A sanitized outbox entry safe to render in the admin view / logs. */
export interface OutboxAdminEntry {
  id: string;
  type: NotificationType;
  /** Opaque water-request id (the same identifier used in audit events). */
  requestId: string;
  /** Opaque resident uid, or null for an unregistered requestor. */
  customerId: string | null;
  state: NotificationState;
  attemptCount: number;
  failureCategory: string | null;
  failureReason: string | null;
  providerMessageId: string | null;
  createdAt: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
}

function iso(value: unknown): string | null {
  const toDate = (value as { toDate?: () => Date } | null)?.toDate;
  return typeof toDate === "function" ? toDate.call(value).toISOString() : null;
}

function toAdminEntry(id: string, data: DocumentData): OutboxAdminEntry {
  return {
    id,
    type: data.type as NotificationType,
    requestId: data.requestId as string,
    customerId: (data.customerId as string | null) ?? null,
    state: data.state as NotificationState,
    attemptCount: typeof data.attemptCount === "number" ? data.attemptCount : 0,
    failureCategory: (data.failureCategory as string | null) ?? null,
    failureReason: (data.failureReason as string | null) ?? null,
    providerMessageId: (data.providerMessageId as string | null) ?? null,
    createdAt: iso(data.createdAt),
    nextAttemptAt: iso(data.nextAttemptAt),
    lastAttemptAt: iso(data.lastAttemptAt),
    sentAt: iso(data.sentAt),
  };
}

/**
 * Lists notifications in a given state, newest first. `failed` (the actionable
 * set) is the default. Uses a single equality filter (no composite index) and
 * sorts in memory — the actionable set is small.
 */
export async function listNotificationsByState(
  state: NotificationState = "failed",
  limit = 100,
): Promise<OutboxAdminEntry[]> {
  const db = getAdminDb();
  const snap = await db
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .where("state", "==", state)
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => toAdminEntry(d.id, d.data()))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Aggregate count of outbox docs per state (cheap `count()` aggregations). */
export async function getOutboxStateCounts(): Promise<
  Record<NotificationState, number>
> {
  const db = getAdminDb();
  const states: NotificationState[] = [
    "pending",
    "processing",
    "sent",
    "failed",
  ];
  const counts = await Promise.all(
    states.map(async (state) => {
      const agg = await db
        .collection(NOTIFICATION_OUTBOX_COLLECTION)
        .where("state", "==", state)
        .count()
        .get();
      return [state, agg.data().count] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<NotificationState, number>;
}

export type RetryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_sent" | "not_failed" };

/**
 * Server-authoritative manual retry of a TERMINAL `failed` notification. Resets
 * it to `pending` and immediately eligible, with a fresh attempt budget.
 * Refuses to touch a `sent` notification (never an accidental resend) or one
 * that is still `pending`/`processing` (already in flight). Idempotent-safe: the
 * decision is made inside a transaction on the current state.
 */
export async function retryFailedNotification(
  notificationId: string,
): Promise<RetryResult> {
  const db = getAdminDb();
  const ref = db.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(notificationId);

  return db.runTransaction<RetryResult>(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const state = snap.data()!.state as NotificationState;
    if (state === "sent") return { ok: false, reason: "already_sent" };
    if (state !== "failed") return { ok: false, reason: "not_failed" };

    const now = FieldValue.serverTimestamp();
    txn.update(ref, {
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      failureCategory: null,
      failureReason: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    return { ok: true };
  });
}
