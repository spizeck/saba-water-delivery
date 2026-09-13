import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import {
  type NotificationState,
  type NotificationType,
  outboxIdFor,
  providerIdempotencyKeyFor,
} from "./outboxPolicy";

/**
 * Durable notification outbox — Firestore data layer (issue #53).
 *
 * The outbox holds the durable INTENT to send an important transactional
 * notification. It is created inside the same Firestore transaction as the
 * business state transition that creates the obligation to notify (see
 * `waterRequests.ts` delivery transitions), so the intent cannot be lost to a
 * crash between committing business state and enqueuing the notification.
 * Sending happens later, asynchronously, in `worker.ts` — never inside that
 * transaction, and never blocking it on Resend.
 *
 * Privacy: the document stores only STABLE REFERENCES (`requestId`,
 * `customerId` — opaque ids) plus non-PII state/timing. It never stores the
 * recipient email, delivery directions, a rendered body, or any secret. The
 * recipient and content are recomputed from the referenced request/profile at
 * send time (see `deliveryConfirmationSender.ts`), so retry never relies on a
 * stale snapshot and no PII is duplicated. Client access is deny-by-default
 * (server-only via the Admin SDK); see firestore.rules.
 */

export const NOTIFICATION_OUTBOX_COLLECTION = "notificationOutbox";

/** The minimal record the worker/sender need. Never carries PII. */
export interface OutboxRecord {
  id: string;
  type: NotificationType;
  requestId: string;
  customerId: string | null;
  providerIdempotencyKey: string;
  state: NotificationState;
  attemptCount: number;
}

export function toOutboxRecord(id: string, data: DocumentData): OutboxRecord {
  return {
    id,
    type: data.type as NotificationType,
    requestId: data.requestId as string,
    customerId: (data.customerId as string | null) ?? null,
    providerIdempotencyKey: data.providerIdempotencyKey as string,
    state: data.state as NotificationState,
    attemptCount: typeof data.attemptCount === "number" ? data.attemptCount : 0,
  };
}

type Db = FirebaseFirestore.Firestore;

/** Deterministic outbox document ref for a request's delivery-confirmation. */
export function deliveryConfirmationOutboxRef(db: Db, requestId: string) {
  return db
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .doc(outboxIdFor("delivery_confirmation_email", requestId));
}

/**
 * Builds the immutable-at-creation intent document for a delivery-confirmation
 * notification. `serverNow` must be a `FieldValue.serverTimestamp()` sentinel so
 * all persisted times are trusted server time. `nextAttemptAt` is set to now so
 * the notification is eligible on the next worker pass.
 *
 * NOTE: only stable references and non-PII state are persisted (see the module
 * doc) — the recipient/content are recomputed at send time.
 */
export function buildDeliveryConfirmationIntent(
  requestId: string,
  customerId: string,
  serverNow: FieldValue,
): DocumentData {
  return {
    type: "delivery_confirmation_email" satisfies NotificationType,
    requestId,
    customerId,
    providerIdempotencyKey: providerIdempotencyKeyFor(requestId),
    state: "pending" satisfies NotificationState,
    attemptCount: 0,
    createdAt: serverNow,
    updatedAt: serverNow,
    nextAttemptAt: serverNow,
    lastAttemptAt: null,
    sentAt: null,
    providerMessageId: null,
    failureCategory: null,
    failureReason: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}
