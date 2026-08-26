import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { appConfig } from "./config";
import { BATCH_ELIGIBLE_STATUSES, computeDispatchBatchStatus } from "./dispatchBatchSelection";
import { isValidSabaVillage } from "./villages";
import { isConfirmationWindowExpired } from "./deliveryConfirmation";
import { isDriverImmediatelyAvailable } from "./driverRegistry";
import { determineInitialDispatchPriority, priorityRankFor } from "./priority";
import type {
  DispatchBatchStatus,
  DispatchPriority,
  ReportedUrgency,
  VulnerableCircumstance,
  WaterRequest,
  WaterRequestCustomerSnapshot,
  WaterRequestSource,
  WaterRequestStatus,
} from "./types";
import { getUserProfile } from "./users";
import { buildWaterSituationSnapshot } from "./waterSituation";
import type { WaterSituationInput } from "./waterSituation";

export { buildWaterSituationSnapshot } from "./waterSituation";
export type { WaterSituationInput } from "./waterSituation";

/**
 * Domain/service layer for water request operations.
 *
 * These functions are the single source of business logic for creating,
 * claiming, and progressing a water request through its lifecycle. Every
 * caller — the resident web UI, the driver web UI, the dispatcher/admin
 * UI, and (later) a WhatsApp integration — must call through these
 * functions rather than writing to Firestore directly.
 */

const REQUESTS_COLLECTION = "waterRequests";
const BATCHES_COLLECTION = "dispatchBatches";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shared helper for keeping `dispatchBatches/{batchId}.status` in sync
 * whenever a batch member's status changes or a member leaves the
 * batch, from WITHIN an already-open transaction. Reads every OTHER
 * current member's status (the caller substitutes the mutating
 * request's own about-to-be-written status, or omits it entirely if it
 * is leaving the batch) and returns the derived status plus the batch
 * document reference to update — the caller performs the actual write,
 * since Firestore transactions require all reads before any writes and
 * callers already have other writes staged by this point.
 *
 * Deliberately implemented with raw Firestore reads here rather than
 * calling into `dispatchBatches.ts`, to avoid a circular module
 * dependency (`dispatchBatches.ts` reads FROM this module to hydrate
 * `WaterRequest`s) — see TECHNICAL.md "Batch Dispatch".
 */
async function readBatchMemberStatusesForSync(
  txn: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  dispatchBatchId: string,
  mutatingRequestId: string,
  /** The mutating request's new status, or null if it is leaving the
   * batch (reassigned to a different driver, or cancelled) and should
   * be excluded from the computed member set entirely. */
  mutatingRequestNewStatus: WaterRequestStatus | null,
): Promise<{ batchRef: FirebaseFirestore.DocumentReference; status: DispatchBatchStatus }> {
  const membersSnap = await txn.get(
    db.collection(REQUESTS_COLLECTION).where("dispatchBatchId", "==", dispatchBatchId),
  );
  const statuses: WaterRequestStatus[] = [];
  for (const doc of membersSnap.docs) {
    if (doc.id === mutatingRequestId) {
      if (mutatingRequestNewStatus) statuses.push(mutatingRequestNewStatus);
      continue;
    }
    statuses.push(doc.data().status as WaterRequestStatus);
  }
  const batchRef = db.collection(BATCHES_COLLECTION).doc(dispatchBatchId);
  return { batchRef, status: computeDispatchBatchStatus(statuses) };
}

/** Statuses that mean the request is still "active" (unresolved). */
const ACTIVE_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "disputed",
];

export function toWaterRequest(id: string, data: DocumentData): WaterRequest {
  return {
    id,
    customerId: data.customerId ?? null,
    customer: data.customer
      ? {
          displayName: data.customer.displayName ?? "",
          phone: data.customer.phone ?? null,
          email: data.customer.email ?? null,
          isRegistered: Boolean(data.customer.isRegistered),
        }
      : null,
    // Historical documents predate `source`/`createdBy` — every request
    // that existed before this field was added came from the resident
    // portal, so "resident" is the correct (not merely convenient)
    // default rather than a guess.
    source: (data.source as WaterRequestSource) ?? "resident",
    createdBy: data.createdBy ?? null,
    gallons: data.gallons,
    village: data.village,
    deliveryDirections: data.deliveryDirections,
    preferredDriverId: data.preferredDriverId ?? null,
    preferredDriverExpiresAt:
      data.preferredDriverExpiresAt?.toDate?.().toISOString() ?? null,
    assignedDriverId: data.assignedDriverId ?? null,
    status: data.status,
    // Historical documents predate `waterSituation`/`dispatchPriority` —
    // treat them as "normal" priority with no situation snapshot rather
    // than guessing (see PRODUCT.md "Historical Snapshot").
    waterSituation: data.waterSituation
      ? {
          personsAffected: data.waterSituation.personsAffected ?? null,
          vulnerableCircumstances:
            (data.waterSituation.vulnerableCircumstances as VulnerableCircumstance[]) ?? [],
          availableStorageCapacity:
            (data.waterSituation.availableStorageCapacity as string | undefined) ?? null,
          reportedUrgency: (data.waterSituation.reportedUrgency as ReportedUrgency) ?? "normal",
          criticalExplanation:
            (data.waterSituation.criticalExplanation as string | undefined) ?? null,
        }
      : null,
    attestationAccepted: data.attestationAccepted ?? null,
    attestationAcceptedAt: data.attestationAcceptedAt?.toDate?.().toISOString() ?? null,
    dispatchPriority: (data.dispatchPriority as DispatchPriority) ?? "normal",
    prioritySource: data.prioritySource === "dispatcher" ? "dispatcher" : "system",
    priorityReason: data.priorityReason ?? null,
    priorityUpdatedBy: data.priorityUpdatedBy ?? null,
    priorityUpdatedAt: data.priorityUpdatedAt?.toDate?.().toISOString() ?? null,
    requestedAt: data.requestedAt?.toDate?.().toISOString() ?? new Date().toISOString(),
    availableAt: data.availableAt?.toDate?.().toISOString() ?? null,
    claimedAt: data.claimedAt?.toDate?.().toISOString() ?? null,
    deliveredAt: data.deliveredAt?.toDate?.().toISOString() ?? null,
    confirmedAt: data.confirmedAt?.toDate?.().toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    dispatchBatchId: data.dispatchBatchId ?? null,
    batchSequence: typeof data.batchSequence === "number" ? data.batchSequence : null,
    dispatchOverrideRank:
      typeof data.dispatchOverrideRank === "number" ? data.dispatchOverrideRank : null,
  };
}

// ---------------------------------------------------------------------------
// Queries — Resident
// ---------------------------------------------------------------------------

/**
 * Returns the resident's currently active (unresolved) request, or null.
 * Used to enforce the one-active-request-per-resident constraint.
 */
export async function getActiveRequestForCustomer(
  customerId: string,
): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", customerId)
    .where("status", "in", ACTIVE_STATUSES)
    .orderBy("requestedAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return toWaterRequest(doc.id, doc.data());
}

/**
 * Returns all water requests for a given customer, most recent first.
 */
export async function getRequestsForCustomer(
  customerId: string,
): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", customerId)
    .orderBy("requestedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

/**
 * Returns the resident's most recently confirmed delivery, or null if
 * they have never had one. Used by the delivery-profile confirmation
 * reminder (see PRODUCT.md / TECHNICAL.md "Delivery Profile
 * Confirmation Reminder") to determine whether a recent completed
 * delivery should count as a fresh review of their delivery
 * information — a completed delivery only ever reaches `"confirmed"`
 * (never `"delivered"`/`"claimed"`/etc.), and this includes deliveries
 * auto-confirmed after the 24-hour window
 * (`checkDeliveryConfirmationTimeout`), since both write the same
 * `status`/`confirmedAt` fields regardless of how confirmation happened.
 *
 * Deliberately a targeted, indexed query (`customerId` + `status` +
 * `confirmedAt`, limit 1) rather than scanning
 * `getRequestsForCustomer()`'s full history on every Resident portal
 * visit — see TECHNICAL.md "Delivery Profile Confirmation Reminder" for
 * the required composite index.
 */
export async function getMostRecentConfirmedRequest(
  customerId: string,
): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", customerId)
    .where("status", "==", "confirmed")
    .orderBy("confirmedAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return toWaterRequest(doc.id, doc.data());
}

// ---------------------------------------------------------------------------
// Queries — Dispatcher request creation
// ---------------------------------------------------------------------------

/**
 * Returns the set of customer uids that currently have an unresolved
 * (active) request. Used by the dispatcher "Create Water Request" search
 * to flag registered residents who already have one, before the
 * dispatcher even attempts to submit — see PRODUCT.md "Duplicate
 * Requests".
 */
export async function getActiveCustomerIds(): Promise<Set<string>> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "in", ACTIVE_STATUSES)
    .get();

  const ids = new Set<string>();
  for (const doc of snapshot.docs) {
    const customerId = doc.data().customerId;
    if (customerId) ids.add(customerId);
  }
  return ids;
}

/**
 * Returns unresolved requests whose customer snapshot has a matching
 * phone number. Used to warn dispatcher staff of a *possible* duplicate
 * before creating a request for an unregistered customer.
 *
 * Phone-number matching is NOT reliable identity verification (shared
 * household phones, typos, reused numbers, etc.) — this is a soft
 * warning for staff judgment, never a silent block. See PRODUCT.md
 * "Duplicate Requests".
 */
export async function findActiveRequestsByPhone(phone: string): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customer.phone", "==", phone)
    .where("status", "in", ACTIVE_STATUSES)
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

// ---------------------------------------------------------------------------
// Queries — Driver dispatch
// ---------------------------------------------------------------------------
//
// NOTE: Drivers no longer browse a list of open requests. The driver
// portal shows at most one claimable offer at a time — see
// src/lib/domain/dispatch.ts (`getNextOfferForDriver`), which selects a
// single candidate request and records it as a `driverOffers` document.
// This module only exposes the low-level request lookup/claim primitives
// that the dispatch layer builds on.

/**
 * Fetches a single water request by ID, or null if it does not exist.
 */
export async function getWaterRequestById(requestId: string): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const doc = await db.collection(REQUESTS_COLLECTION).doc(requestId).get();
  if (!doc.exists) return null;
  return toWaterRequest(doc.id, doc.data()!);
}

/**
 * Returns requests currently claimed by (assigned to) this driver.
 */
export async function getClaimedRequestsForDriver(
  driverId: string,
): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("assignedDriverId", "==", driverId)
    .where("status", "==", "claimed")
    .orderBy("claimedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

// ---------------------------------------------------------------------------
// Queries — Batch Dispatch
// ---------------------------------------------------------------------------

/**
 * Returns every request currently eligible for Batch Dispatch, ordered
 * by dispatch priority then request age — the same fairness ordering
 * used everywhere else (see `sortForBatchSelection` in
 * `dispatchBatchSelection.ts`, which the caller should still apply for
 * display, since this query's `orderBy` is the source of truth but
 * kept here as a single indexed round trip). Reuses the existing
 * `status + priorityRank + requestedAt` composite index — no new index
 * required for this query specifically.
 */
export async function getBatchEligibleRequests(): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "in", BATCH_ELIGIBLE_STATUSES)
    .orderBy("priorityRank", "asc")
    .orderBy("requestedAt", "asc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

/**
 * Returns the current members of a dispatch batch, ordered by their
 * original run-sheet sequence. Current membership is determined by
 * `dispatchBatchId` on the request itself (queried directly), not by
 * `dispatchBatches.originalRequestIds` — a request can leave a batch
 * (reassigned to a different driver, or cancelled) without that
 * historical array being rewritten. See TECHNICAL.md "Batch Dispatch".
 */
export async function getRequestsForDispatchBatch(batchId: string): Promise<WaterRequest[]> {
  const db = getAdminDb();
  // Do not orderBy "batchSequence" here — the equality on "dispatchBatchId"
  // needs a single-field index (already present), while adding orderBy would
  // require a composite index that may not be deployed. Sort in memory after
  // the fetch; the result set is always small.
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("dispatchBatchId", "==", batchId)
    .get();

  return snapshot.docs
    .map((doc) => toWaterRequest(doc.id, doc.data()))
    .sort((a, b) => (a.batchSequence ?? 0) - (b.batchSequence ?? 0));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Caller-supplied water-situation answers. See PRODUCT.md "Additional
 * Water Request Information". This is the raw form input; the stable,
 * immutable `WaterSituationSnapshot` stored on the request is derived
 * from this in `buildWaterSituationSnapshot()` below.
 */
export interface CreateWaterRequestInput {
  /** Firebase uid of the resident, or null for an unregistered/manual customer. */
  customerId: string | null;
  village: string;
  deliveryDirections: string;
  preferredDriverId?: string | null;
  /** Defaults to "resident" — the resident portal never needs to pass this. */
  source?: WaterRequestSource;
  /** uid of the dispatcher/admin creating the request. Required when source is "dispatcher". */
  createdBy?: string | null;
  /**
   * Customer identity snapshot. Required (displayName + phone) when
   * `customerId` is null (unregistered customer). Optional when
   * `customerId` is set — if omitted, it is built automatically from the
   * resident's saved profile so every request gets a consistent snapshot.
   */
  customer?: Pick<WaterRequestCustomerSnapshot, "displayName" | "phone" | "email"> | null;
  /**
   * Request IDs of a possible-duplicate match the caller deliberately
   * chose to proceed past (see `findActiveRequestsByPhone`). Recorded on
   * the creation audit event for traceability — never silent.
   */
  overrideMatchedRequestIds?: string[];
  /** Resident's reported water situation at request time. Required for
   * both resident and dispatcher-created requests — see PRODUCT.md
   * "Dispatcher Manual Requests" (staff capture the same information). */
  waterSituation: WaterSituationInput;
  /**
   * Attestation that the request is authorized and the statements are
   * true. For resident requests, the resident confirms their own
   * attestation. For dispatcher-created requests, the staff member
   * confirms they accurately recorded the information provided by the
   * caller — not that they personally made a citizen attestation.
   */
  attestationAccepted: boolean;
}

/**
 * Creates a new water request.
 *
 * For a registered resident (`customerId` set), a Firestore transaction
 * atomically verifies the resident does not already have an active
 * request before creating a new one — this hard one-active-request rule
 * applies identically whether the resident submits it themselves or a
 * dispatcher enters it on their behalf.
 *
 * For an unregistered/manual customer (`customerId` null), there is no
 * stable uid to enforce that same hard rule against, so duplicate
 * protection is a caller-side soft check (see `findActiveRequestsByPhone`)
 * rather than a transactional guarantee — see PRODUCT.md "Duplicate
 * Requests".
 *
 * - Sets gallons to the system standard (1,000).
 * - If a preferred driver is selected, sets status to
 *   "preferred_driver_hold" with the configured expiration window.
 * - Otherwise, sets status to "available" immediately.
 * - Records a "request_created" (resident) or "request_created_by_dispatcher"
 *   (staff) audit event, and optionally "preferred_driver_selected".
 */
export async function createWaterRequest(
  input: CreateWaterRequestInput,
): Promise<WaterRequest> {
  const db = getAdminDb();
  const {
    customerId,
    village,
    deliveryDirections,
    preferredDriverId,
    source = "resident",
    createdBy = null,
    customer: customerInput,
    overrideMatchedRequestIds,
    waterSituation: waterSituationInput,
    attestationAccepted,
  } = input;

  if (!customerId && !customerInput?.displayName?.trim()) {
    throw new Error("CUSTOMER_NAME_REQUIRED");
  }
  if (!customerId && !customerInput?.phone?.trim()) {
    throw new Error("CUSTOMER_PHONE_REQUIRED");
  }
  if (source === "dispatcher" && !createdBy) {
    throw new Error("CREATED_BY_REQUIRED");
  }
  if (!attestationAccepted) {
    throw new Error("ATTESTATION_REQUIRED");
  }
  if (!isValidSabaVillage(village)) {
    throw new Error("INVALID_VILLAGE");
  }

  const waterSituation = buildWaterSituationSnapshot(waterSituationInput);
  const { priority: dispatchPriority, reason: priorityReason } =
    determineInitialDispatchPriority(waterSituation);

  // Build a stable customer snapshot at creation time. Registered
  // residents get one built from their saved profile unless the caller
  // already supplied one; unregistered customers must supply their own.
  let customerSnapshot: WaterRequestCustomerSnapshot;
  if (customerId) {
    if (customerInput) {
      customerSnapshot = { ...customerInput, isRegistered: true };
    } else {
      const profile = await getUserProfile(customerId);
      customerSnapshot = {
        displayName: profile?.displayName ?? "",
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
        isRegistered: true,
      };
    }
  } else {
    customerSnapshot = {
      displayName: customerInput!.displayName.trim(),
      phone: customerInput!.phone,
      email: customerInput!.email ?? null,
      isRegistered: false,
    };
  }

  const hasPreferredDriver = Boolean(preferredDriverId);

  // A preferred driver is a resident PREFERENCE, never a guaranteed
  // assignment (see PRODUCT.md "Preferred Driver"). For a Normal request
  // the preference always gets an exclusive hold window, even if the
  // driver is currently offline (they may come online before it
  // expires). For an Urgent/Critical request, an offline/ineligible/
  // unlinked/cooldown preferred driver must not delay dispatch at all —
  // see PRODUCT.md "Preferred Driver Offline Edge Case" — so the hold is
  // skipped entirely and the request goes straight to the general queue.
  const preferredDriverImmediatelyAvailable = hasPreferredDriver
    ? await isDriverImmediatelyAvailable(preferredDriverId!)
    : false;
  const skipHoldForPriority =
    hasPreferredDriver && dispatchPriority !== "normal" && !preferredDriverImmediatelyAvailable;
  const willHold = hasPreferredDriver && !skipHoldForPriority;

  const now = FieldValue.serverTimestamp();

  // Compute the preferred-driver expiration time if applicable.
  const preferredDriverExpiresAt = willHold
    ? new Date(Date.now() + appConfig.preferredDriverWindowHours * 60 * 60 * 1000)
    : null;

  const initialStatus: WaterRequestStatus = willHold ? "preferred_driver_hold" : "available";

  const requestRef = db.collection(REQUESTS_COLLECTION).doc();

  // A resident whose previous delivery's confirmation window has already
  // expired must not stay permanently blocked just because nobody opened
  // that old request since. Resolve it (auto-confirm) *before* the
  // one-active-request check below, so an expired "delivered" request
  // never counts as an active request — see PRODUCT.md "Delivery
  // Confirmation" / TECHNICAL.md "Delivery Confirmation Timeout". This
  // is a best-effort pre-step; the transactional duplicate check below
  // remains the actual source of correctness.
  if (customerId) {
    const staleDeliveredSnapshot = await db
      .collection(REQUESTS_COLLECTION)
      .where("customerId", "==", customerId)
      .where("status", "==", "delivered")
      .limit(1)
      .get();
    if (!staleDeliveredSnapshot.empty) {
      await checkDeliveryConfirmationTimeout(staleDeliveredSnapshot.docs[0].id);
    }
  }

  await db.runTransaction(async (txn) => {
    // The hard one-active-request rule only applies to registered
    // residents, who have a stable uid to check against. Unregistered
    // customers are handled by a caller-side soft duplicate check
    // instead (see `findActiveRequestsByPhone`) — checking by customerId
    // here would be meaningless since every unregistered request shares
    // customerId === null.
    if (customerId) {
      const existingSnapshot = await txn.get(
        db
          .collection(REQUESTS_COLLECTION)
          .where("customerId", "==", customerId)
          .where("status", "in", ACTIVE_STATUSES)
          .limit(1),
      );

      if (!existingSnapshot.empty) {
        throw new Error("DUPLICATE_ACTIVE_REQUEST");
      }
    }

    const requestData: Record<string, unknown> = {
      customerId,
      customer: customerSnapshot,
      source,
      createdBy: source === "dispatcher" ? createdBy : null,
      gallons: appConfig.standardLoadGallons,
      village,
      deliveryDirections,
      preferredDriverId: preferredDriverId ?? null,
      preferredDriverExpiresAt: preferredDriverExpiresAt,
      assignedDriverId: null,
      status: initialStatus,
      waterSituation,
      attestationAccepted,
      attestationAcceptedAt: now,
      dispatchPriority,
      priorityRank: priorityRankFor(dispatchPriority),
      prioritySource: "system",
      priorityReason,
      priorityUpdatedBy: null,
      priorityUpdatedAt: null,
      requestedAt: now,
      availableAt: willHold ? null : now,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      dispatchOverrideRank: null,
      createdAt: now,
      updatedAt: now,
    };

    txn.set(requestRef, requestData);

    const creationActorId = source === "dispatcher" ? createdBy : customerId;

    // Audit event: request_created / request_created_by_dispatcher
    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: source === "dispatcher" ? "request_created_by_dispatcher" : "request_created",
      actorId: creationActorId,
      actorRole: source === "dispatcher" ? "dispatcher" : "resident",
      createdAt: now,
      metadata: {
        village,
        preferredDriverId: preferredDriverId ?? null,
        isRegisteredCustomer: Boolean(customerId),
        dispatchPriority,
        priorityReason,
        ...(overrideMatchedRequestIds?.length
          ? { overrodeDuplicateWarningFor: overrideMatchedRequestIds }
          : {}),
      },
    });

    // Additional audit event if a preferred driver was selected.
    if (hasPreferredDriver) {
      if (willHold) {
        const prefEventRef = requestRef.collection("events").doc();
        txn.set(prefEventRef, {
          type: "preferred_driver_selected",
          actorId: creationActorId,
          actorRole: source === "dispatcher" ? "dispatcher" : "resident",
          createdAt: now,
          metadata: {
            driverId: preferredDriverId,
            expiresAt: preferredDriverExpiresAt?.toISOString() ?? null,
          },
        });
      } else {
        // The preference was bypassed because the request is Urgent/
        // Critical and the preferred driver was not immediately
        // available — see PRODUCT.md "Preferred Driver Offline Edge
        // Case". The preference is preserved on the request for
        // display/statistics, but never blocked general dispatch.
        const bypassEventRef = requestRef.collection("events").doc();
        txn.set(bypassEventRef, {
          type: "preferred_driver_bypassed_for_priority",
          actorId: creationActorId,
          actorRole: source === "dispatcher" ? "dispatcher" : "resident",
          createdAt: now,
          metadata: {
            driverId: preferredDriverId,
            dispatchPriority,
            reason:
              "Preferred driver was not immediately available (offline, ineligible, unlinked, or in cooldown); released directly to the general queue rather than delaying an urgent/critical request.",
          },
        });
      }
    }
  });

  // Read back the created document to return the full WaterRequest.
  const created = await requestRef.get();
  return toWaterRequest(requestRef.id, created.data()!);
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export interface ClaimWaterRequestInput {
  requestId: string;
  driverId: string;
}

/**
 * Atomically claims a water request for a driver.
 *
 * Uses a Firestore transaction to guarantee:
 *   - The request exists and is claimable (status "available" or
 *     "preferred_driver_hold" addressed to this driver and not expired).
 *   - No other driver has already claimed it.
 *   - The driver document exists, is eligible, and is online.
 *
 * On success:
 *   - Sets assignedDriverId, status → "claimed", claimedAt, updatedAt.
 *   - Creates a "driver_claimed" audit event.
 *
 * Only one concurrent driver may succeed — the others receive a clean
 * error (CLAIM_FAILED).
 */
export async function claimWaterRequest(
  input: ClaimWaterRequestInput,
): Promise<WaterRequest> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  // Driver eligibility/availability now lives on the Driver Registry
  // entry linked to this uid. See TECHNICAL.md "Driver Registry".
  const driverQuery = db
    .collection("driverRegistry")
    .where("linkedUserId", "==", driverId)
    .limit(1);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [requestSnap, driverQuerySnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(driverQuery),
    ]);

    // --- Validate request ---
    if (!requestSnap.exists) {
      throw new Error("REQUEST_NOT_FOUND");
    }
    const reqData = requestSnap.data()!;

    if (reqData.assignedDriverId) {
      throw new Error("ALREADY_CLAIMED");
    }

    const status = reqData.status as WaterRequestStatus;

    if (status === "preferred_driver_hold") {
      // Only the preferred driver may claim during the hold.
      if (reqData.preferredDriverId !== driverId) {
        throw new Error("PREFERRED_DRIVER_RESTRICTION");
      }
      // Check if the hold has expired.
      const expiresAt = reqData.preferredDriverExpiresAt?.toDate?.();
      if (expiresAt && expiresAt <= new Date()) {
        throw new Error("HOLD_EXPIRED");
      }
    } else if (status !== "available") {
      throw new Error("REQUEST_NOT_CLAIMABLE");
    }

    // --- Validate driver ---
    if (driverQuerySnap.empty) {
      throw new Error("DRIVER_NOT_FOUND");
    }
    const drvData = driverQuerySnap.docs[0].data();
    const registryRef = driverQuerySnap.docs[0].ref;

    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }
    if (drvData.availabilityStatus !== "online") {
      throw new Error("DRIVER_OFFLINE");
    }

    // One-active-delivery invariant: a driver may only claim another request
    // if they have no active claimed delivery. Reading/writing this on the
    // registry document serializes concurrent claims so the invariant holds
    // even with stale offers or direct server-action calls.
    const activeRequestId = drvData.activeRequestId ?? null;
    if (!activeRequestId) {
      // Defensive fallback for registry entries created before the
      // activeRequestId field existed. A missing field is treated as no
      // lock only if there is no other claimed request for this driver.
      const activeClaimSnap = await txn.get(
        db
          .collection(REQUESTS_COLLECTION)
          .where("assignedDriverId", "==", driverId)
          .where("status", "==", "claimed")
          .limit(1),
      );
      if (!activeClaimSnap.empty) {
        throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
      }
    }
    if (activeRequestId && activeRequestId !== requestId) {
      throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
    }

    // --- Perform the claim ---
    txn.update(requestRef, {
      assignedDriverId: driverId,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
    });

    txn.update(registryRef, {
      activeRequestId: requestId,
      updatedAt: now,
      updatedBy: driverId,
    });

    // Audit event
    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "driver_claimed",
      actorId: driverId,
      actorRole: "driver",
      createdAt: now,
      metadata: {
        previousStatus: status,
      },
    });
  });

  const claimed = await requestRef.get();
  return toWaterRequest(requestId, claimed.data()!);
}

// ---------------------------------------------------------------------------
// Preferred-driver hold expiration
// ---------------------------------------------------------------------------

export interface ExpirePreferredDriverHoldInput {
  requestId: string;
}

/**
 * Transitions a request from "preferred_driver_hold" to "available".
 *
 * This is called lazily when the driver queue is read and an expired hold
 * is discovered. It uses a transaction to avoid racing with a claim
 * attempt from the preferred driver.
 */
export async function expirePreferredDriverHold(
  input: ExpirePreferredDriverHoldInput,
): Promise<WaterRequest> {
  const { requestId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) {
      throw new Error("REQUEST_NOT_FOUND");
    }

    const data = snap.data()!;
    // Only expire if still in hold status (another reader may have already expired it).
    if (data.status !== "preferred_driver_hold") return;

    txn.update(requestRef, {
      status: "available",
      availableAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "preferred_driver_expired",
      actorId: null,
      actorRole: null,
      createdAt: now,
      metadata: {
        preferredDriverId: data.preferredDriverId,
        expiredAt: data.preferredDriverExpiresAt?.toDate?.().toISOString() ?? null,
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Dispatcher priority override
// ---------------------------------------------------------------------------

export interface ChangeRequestPriorityInput {
  requestId: string;
  actorId: string;
  newPriority: DispatchPriority;
  reason: string;
}

/**
 * Dispatcher/admin override of a request's operational dispatch
 * priority. Always requires a reason, which is audited alongside the
 * previous/new priority and acting staff member (see PRODUCT.md
 * "Dispatcher Priority Review"). Never overwrites the resident's
 * original `waterSituation` snapshot — only the derived
 * `dispatchPriority` fields change.
 *
 * If this escalates a request that is currently held for a preferred
 * driver, the hold is immediately re-evaluated and released to the
 * general queue if the preferred driver is not currently immediately
 * available — all within the same Firestore transaction.
 */
export async function changeRequestPriority(
  input: ChangeRequestPriorityInput,
): Promise<WaterRequest> {
  const { requestId, actorId, newPriority, reason } = input;
  if (!reason.trim()) throw new Error("PRIORITY_REASON_REQUIRED");

  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);

  await db.runTransaction(async (txn) => {
    // ---- All reads first ----
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");
    const data = snap.data()!;
    const previousPriority = (data.dispatchPriority as DispatchPriority) ?? "normal";

    // Determine whether an active preferred-driver hold must be released.
    let releaseHold = false;
    if (
      newPriority !== "normal" &&
      data.status === "preferred_driver_hold" &&
      data.preferredDriverId
    ) {
      const registrySnap = await txn.get(
        db
          .collection("driverRegistry")
          .where("linkedUserId", "==", data.preferredDriverId)
          .limit(1),
      );
      if (registrySnap.empty) {
        // No linked registry means no eligible driver can hold this request.
        releaseHold = true;
      } else {
        const regData = registrySnap.docs[0].data();
        const eligible = regData.eligibilityStatus === "eligible";
        const online = regData.availabilityStatus === "online";
        const inCooldown =
          regData.cooldownUntil?.toDate?.() instanceof Date &&
          regData.cooldownUntil.toDate() > new Date();
        releaseHold = !eligible || !online || inCooldown;
      }
    }

    // ---- All writes after reads ----
    const now = FieldValue.serverTimestamp();
    const updateData: Record<string, unknown> = {
      dispatchPriority: newPriority,
      priorityRank: priorityRankFor(newPriority),
      prioritySource: "dispatcher",
      priorityReason: reason.trim(),
      priorityUpdatedBy: actorId,
      priorityUpdatedAt: now,
      updatedAt: now,
    };

    if (releaseHold) {
      updateData.status = "available";
      updateData.availableAt = now;
    }

    txn.update(requestRef, updateData);

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "request_priority_changed",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: {
        previousPriority,
        newPriority,
        reason: reason.trim(),
      },
    });

    if (releaseHold) {
      const releaseRef = requestRef.collection("events").doc();
      txn.set(releaseRef, {
        type: "preferred_driver_hold_released_for_priority",
        actorId: null,
        actorRole: null,
        createdAt: now,
        metadata: {
          preferredDriverId: data.preferredDriverId,
          dispatchPriority: newPriority,
        },
      });
    }
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Mark delivered
// ---------------------------------------------------------------------------

export interface MarkWaterDeliveredInput {
  requestId: string;
  driverId: string;
}

/**
 * Marks a claimed request as delivered.
 *
 * Only the assigned driver may do this. Uses a transaction to prevent
 * race conditions.
 *
 * The driver's `activeRequestId` lock is cleared only if it currently
 * points at THIS request. Before Batch Dispatch, a driver could never
 * have more than one `"claimed"` request, so this was always true; now
 * that a driver may hold several batch-assigned claimed requests at
 * once (see TECHNICAL.md "Batch Dispatch"), clearing it unconditionally
 * would incorrectly release a genuinely active self-claimed/singly-
 * assigned delivery when a driver happens to deliver an unrelated batch
 * load first.
 */
export async function markWaterDelivered(
  input: MarkWaterDeliveredInput,
): Promise<WaterRequest> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const driverQuery = db
    .collection("driverRegistry")
    .where("linkedUserId", "==", driverId)
    .limit(1);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [snap, driverQuerySnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(driverQuery),
    ]);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.status !== "claimed") {
      throw new Error("REQUEST_NOT_CLAIMABLE");
    }
    if (data.assignedDriverId !== driverId) {
      throw new Error("NOT_ASSIGNED_DRIVER");
    }

    // If this request belongs to a batch, read the batch's OTHER member
    // statuses now (all reads must happen before any writes in a
    // Firestore transaction) so the batch's derived status can be kept
    // in sync in the same transaction — see TECHNICAL.md "Batch
    // Dispatch" "Interaction with activeRequestId".
    const dispatchBatchId = (data.dispatchBatchId as string | null) ?? null;
    const batchSync = dispatchBatchId
      ? await readBatchMemberStatusesForSync(txn, db, dispatchBatchId, requestId, "delivered")
      : null;

    txn.update(requestRef, {
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

    // Clear the driver's active delivery lock ONLY if it currently
    // points at this request, so an unrelated genuinely-active delivery
    // (self-claimed, or a different batch load) is never released.
    if (!driverQuerySnap.empty && driverQuerySnap.docs[0].data().activeRequestId === requestId) {
      const registryRef = driverQuerySnap.docs[0].ref;
      txn.update(registryRef, {
        activeRequestId: null,
        updatedAt: now,
        updatedBy: driverId,
      });
    }

    if (batchSync) {
      txn.update(batchSync.batchRef, { status: batchSync.status, updatedAt: now });
    }

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "marked_delivered",
      actorId: driverId,
      actorRole: "driver",
      createdAt: now,
      metadata: null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Staff-recorded delivery (batch or ordinary)
// ---------------------------------------------------------------------------

export interface MarkWaterDeliveredByStaffInput {
  requestId: string;
  actorId: string;
  note?: string;
}

/**
 * Lets dispatcher/admin staff record a claimed request as delivered on
 * behalf of a driver who cannot (or did not) mark it delivered through
 * the driver portal. This is used for Batch Dispatch paper
 * reconciliation, and for ordinary requests when the driver is
 * unavailable or the delivery was confirmed by phone/radio.
 *
 * The request must be in `"claimed"` status with an assigned driver.
 * The driver's `activeRequestId` lock is cleared only if it points at
 * this request, and an active batch's derived status is kept in sync.
 *
 * Records `marked_delivered_by_dispatcher_batch` for batch-assigned
 * loads and `marked_delivered_by_dispatcher` for normal assignments,
 * so the audit trail never misrepresents a staff entry as the driver's
 * own action.
 */
export async function markWaterDeliveredByStaff(
  input: MarkWaterDeliveredByStaffInput,
): Promise<WaterRequest> {
  const { requestId, actorId, note } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;
    if (data.status !== "claimed") throw new Error("REQUEST_NOT_CLAIMABLE");

    const assignedDriverId = data.assignedDriverId as string | null | undefined;
    const dispatchBatchId = (data.dispatchBatchId as string | null) ?? null;

    let registryRef: FirebaseFirestore.DocumentReference | null = null;
    if (assignedDriverId) {
      const driverQuery = db
        .collection("driverRegistry")
        .where("linkedUserId", "==", assignedDriverId)
        .limit(1);
      const driverSnap = await txn.get(driverQuery);
      if (!driverSnap.empty && driverSnap.docs[0].data().activeRequestId === requestId) {
        registryRef = driverSnap.docs[0].ref;
      }
    }

    const batchSync = dispatchBatchId
      ? await readBatchMemberStatusesForSync(txn, db, dispatchBatchId, requestId, "delivered")
      : null;

    txn.update(requestRef, {
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

    if (registryRef) {
      txn.update(registryRef, { activeRequestId: null, updatedAt: now, updatedBy: actorId });
    }

    if (batchSync) {
      txn.update(batchSync.batchRef, { status: batchSync.status, updatedAt: now });
    }

    const eventRef = requestRef.collection("events").doc();
    const metadata: Record<string, unknown> = {
      assignedDriverId: assignedDriverId ?? null,
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
    if (dispatchBatchId) {
      metadata.dispatchBatchId = dispatchBatchId;
    }
    txn.set(eventRef, {
      type: dispatchBatchId ? "marked_delivered_by_dispatcher_batch" : "marked_delivered_by_dispatcher",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

/**
 * Backwards-compatible alias for Batch Dispatch paper reconciliation.
 * @deprecated Use `markWaterDeliveredByStaff` directly.
 */
export const recordBatchDeliveryByStaff = markWaterDeliveredByStaff;

// ---------------------------------------------------------------------------
// Manual dispatch escalation
// ---------------------------------------------------------------------------

export interface EscalateDispatchRequestInput {
  requestId: string;
  actorId: string;
  reason: string;
}

/**
 * Deliberately moves an outstanding request ahead in the dispatch queue
 * without touching its original `requestedAt` or inventing a fake
 * priority. Only `available` or `preferred_driver_hold` requests can be
 * escalated. A `preferred_driver_hold` is released to the general queue
 * as part of the action, making it eligible for the next valid driver
 * immediately. The override rank is set to `0` (the canonical "ahead of
 * normal" value) and the original `requestedAt` and `dispatchPriority`
 * are preserved.
 *
 * Records a `dispatch_order_overridden` audit event that captures the
 * previous override rank, the new one, the reason, the actor, and the
 * timestamp so the action is always auditable.
 */
export async function escalateDispatchRequest(
  input: EscalateDispatchRequestInput,
): Promise<WaterRequest> {
  const { requestId, actorId, reason } = input;
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("ESCALATE_REASON_REQUIRED");

  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;
    const status = data.status as WaterRequestStatus;
    const previousOverrideRank =
      typeof data.dispatchOverrideRank === "number" ? data.dispatchOverrideRank : null;

    if (status !== "available" && status !== "preferred_driver_hold") {
      throw new Error("REQUEST_NOT_ESCALATABLE");
    }

    const updates: Record<string, unknown> = {
      dispatchOverrideRank: 0,
      updatedAt: now,
    };

    if (status === "preferred_driver_hold") {
      updates.status = "available";
      updates.availableAt = now;
    }

    txn.update(requestRef, updates);

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "dispatch_order_overridden",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: {
        previousOverrideRank,
        newOverrideRank: 0,
        reason: trimmedReason,
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Customer confirmation
// ---------------------------------------------------------------------------

export interface ConfirmWaterDeliveryInput {
  requestId: string;
  customerId: string;
}

/**
 * Customer confirms they received the delivery.
 *
 * Transitions status from "delivered" to "confirmed". This resolves the
 * request, allowing the customer to create a new one.
 */
export async function confirmWaterDelivery(
  input: ConfirmWaterDeliveryInput,
): Promise<WaterRequest> {
  const { requestId, customerId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.customerId !== customerId) {
      throw new Error("NOT_REQUEST_OWNER");
    }
    if (data.status !== "delivered") {
      throw new Error("INVALID_STATUS_FOR_CONFIRM");
    }

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "customer_confirmed",
      actorId: customerId,
      actorRole: "resident",
      createdAt: now,
      metadata: null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Customer dispute
// ---------------------------------------------------------------------------

export interface DisputeWaterDeliveryInput {
  requestId: string;
  customerId: string;
  reason?: string;
}

/**
 * Customer disputes that the delivery was received correctly.
 *
 * Transitions status to "disputed". The request remains unresolved and
 * blocks a new request until it is resolved by government staff.
 */
export async function disputeWaterDelivery(
  input: DisputeWaterDeliveryInput,
): Promise<WaterRequest> {
  const { requestId, customerId, reason } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.customerId !== customerId) {
      throw new Error("NOT_REQUEST_OWNER");
    }
    if (data.status !== "delivered") {
      throw new Error("INVALID_STATUS_FOR_DISPUTE");
    }

    txn.update(requestRef, {
      status: "disputed",
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "customer_disputed",
      actorId: customerId,
      actorRole: "resident",
      createdAt: now,
      metadata: reason ? { reason } : null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Staff confirmation (unregistered customers)
// ---------------------------------------------------------------------------

export interface ConfirmDeliveryByStaffInput {
  requestId: string;
  actorId: string;
}

/**
 * Allows dispatcher/admin staff to operationally close out a delivery on
 * behalf of an unregistered customer, who has no authenticated resident
 * portal to confirm or dispute through themselves.
 *
 * Deliberately scoped to unregistered requests only — a registered
 * resident's delivery must go through their own confirm/dispute workflow
 * (`confirmWaterDelivery` / `disputeWaterDelivery`); staff should use the
 * existing dispute-resolution tools for those instead of this shortcut.
 *
 * Records a distinct `delivery_confirmed_by_dispatcher` audit event
 * rather than `customer_confirmed`, so the record never misrepresents
 * this as the customer's own action. Designed to remain compatible with
 * a future WhatsApp confirmation flow for unregistered customers, which
 * would call `confirmWaterDelivery`-equivalent logic once that customer
 * can respond directly — this staff path is a V1 stand-in, not a
 * replacement for that.
 */
export async function confirmDeliveryByStaff(
  input: ConfirmDeliveryByStaffInput,
): Promise<WaterRequest> {
  const { requestId, actorId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.customerId) {
      throw new Error("REQUEST_HAS_REGISTERED_CUSTOMER");
    }
    if (data.status !== "delivered") {
      throw new Error("INVALID_STATUS_FOR_CONFIRM");
    }

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "delivery_confirmed_by_dispatcher",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: null,
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Delivery confirmation timeout (lazy auto-confirmation)
// ---------------------------------------------------------------------------

/**
 * Checks if a "delivered" request has exceeded the resident's
 * confirmation window and, if so, automatically confirms it.
 *
 * There is no separate "unconfirmed" status: an expired "delivered"
 * request transitions straight to "confirmed" (`confirmedAt` set) with a
 * distinct `delivery_auto_confirmed` audit event — never `customer_confirmed`,
 * since no resident actually responded (see PRODUCT.md "Delivery
 * Confirmation"). Driver availability is unaffected either way: the
 * driver was already released from this delivery when it was marked
 * `delivered` (see `markWaterDelivered()`), so customer confirmation
 * (manual or automatic) never gates a driver's next assignment.
 *
 * This is enforced lazily — called opportunistically wherever a
 * "delivered" request is read by an operational workflow (resident
 * portal, dispatcher dashboard/detail, request creation) — not by a
 * precisely-scheduled job. See TECHNICAL.md "Delivery Confirmation
 * Timeout" for why V1 does not introduce scheduled Cloud Functions for
 * this. Does nothing if the request is not "delivered" or the window
 * has not yet passed.
 */
export async function checkDeliveryConfirmationTimeout(
  requestId: string,
): Promise<WaterRequest | null> {
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);

  const snap = await requestRef.get();
  if (!snap.exists) return null;

  const data = snap.data()!;
  if (data.status !== "delivered") {
    return toWaterRequest(requestId, data);
  }

  const deliveredAt = data.deliveredAt?.toDate?.();
  if (!deliveredAt) return toWaterRequest(requestId, data);

  if (!isConfirmationWindowExpired(deliveredAt)) {
    // Still within confirmation window.
    return toWaterRequest(requestId, data);
  }

  // Expired — automatically confirm. This is a SYSTEM action, so it must
  // never be recorded as `customer_confirmed`.
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (txn) => {
    const freshSnap = await txn.get(requestRef);
    if (!freshSnap.exists) return;
    const freshData = freshSnap.data()!;

    // Only transition if still in "delivered" (prevent double-transition
    // race, e.g. the resident confirmed/disputed concurrently).
    if (freshData.status !== "delivered") return;

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "delivery_auto_confirmed",
      actorId: null,
      actorRole: null,
      createdAt: now,
      metadata: {
        deliveredAt: deliveredAt.toISOString(),
        windowHours: appConfig.deliveryConfirmationWindowHours,
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Dispatcher operations
// ---------------------------------------------------------------------------

/**
 * Returns all water requests for the dispatcher operational view.
 * Orders by requestedAt descending (most recent first).
 */
export async function getAllRequests(): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .orderBy("requestedAt", "desc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

/**
 * Counts how many requests this customer has created in the last
 * `windowDays` days. Registered customers are matched by `customerId`;
 * unregistered customers are matched by the phone number stored on
 * their request snapshot. This is a dispatcher-facing operational
 * warning only — it never blocks a request by itself.
 */
export async function getFrequentRequestCountForCustomer(
  customerId: string | null,
  phone: string | null,
  now = new Date(),
  windowDays = 7,
): Promise<number> {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const all = await getAllRequests();
  const normalizedPhone = (phone ?? "").trim();

  let count = 0;
  for (const r of all) {
    if (!r.requestedAt || r.requestedAt < cutoff) continue;
    if (customerId && r.customerId === customerId) {
      count++;
      continue;
    }
    if (normalizedPhone && r.customer?.phone?.trim() === normalizedPhone) {
      count++;
    }
  }
  return count;
}

/**
 * Statuses that represent outstanding driver work for the nightly/manual
 * continuity snapshot (see PRODUCT.md / TECHNICAL.md "Operational
 * Continuity Snapshot"): unassigned loads still waiting for a driver,
 * plus loads a driver has already claimed. Deliberately excludes
 * "delivered" (physical delivery already occurred — see PRODUCT.md),
 * "confirmed", and "cancelled".
 */
const OUTSTANDING_REQUEST_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
];

/**
 * Read-only query for the operational continuity snapshot — see
 * `src/lib/domain/continuityReport.ts`. Never mutates any request or
 * driver state.
 */
export async function getOutstandingRequestsForContinuityReport(): Promise<WaterRequest[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "in", OUTSTANDING_REQUEST_STATUSES)
    .orderBy("requestedAt", "asc")
    .get();

  return snapshot.docs.map((doc) => toWaterRequest(doc.id, doc.data()));
}

/**
 * Returns the event history for a specific request, ordered chronologically.
 */
export async function getRequestEvents(
  requestId: string,
): Promise<Array<{ id: string; type: string; actorId: string | null; actorRole: string | null; createdAt: string; metadata: Record<string, unknown> | null }>> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .doc(requestId)
    .collection("events")
    .orderBy("createdAt", "asc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type,
      actorId: data.actorId ?? null,
      actorRole: data.actorRole ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
      metadata: data.metadata ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Cancel request
// ---------------------------------------------------------------------------

export interface CancelWaterRequestInput {
  requestId: string;
  actorId: string;
  reason: string;
}

/**
 * Cancels an unresolved request. Staff only.
 */
export async function cancelWaterRequest(
  input: CancelWaterRequestInput,
): Promise<WaterRequest> {
  const { requestId, actorId, reason } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;
    const resolved: WaterRequestStatus[] = ["confirmed", "cancelled"];
    if (resolved.includes(data.status)) {
      throw new Error("REQUEST_ALREADY_RESOLVED");
    }

    const assignedDriverId = data.assignedDriverId as string | null | undefined;
    let registryRef: FirebaseFirestore.DocumentReference | null = null;
    if (data.status === "claimed" && assignedDriverId) {
      const driverQuery = db
        .collection("driverRegistry")
        .where("linkedUserId", "==", assignedDriverId)
        .limit(1);
      const driverSnap = await txn.get(driverQuery);
      if (!driverSnap.empty) {
        const driverData = driverSnap.docs[0].data();
        if (driverData.activeRequestId === requestId) {
          registryRef = driverSnap.docs[0].ref;
        }
      }
    }

    // Cancellation removes a batch-assigned request from its batch's
    // current membership entirely (see TECHNICAL.md "Batch Dispatch") —
    // read the other members' statuses now, before any writes.
    const dispatchBatchId = (data.dispatchBatchId as string | null) ?? null;
    const batchSync = dispatchBatchId
      ? await readBatchMemberStatusesForSync(txn, db, dispatchBatchId, requestId, null)
      : null;

    txn.update(requestRef, {
      status: "cancelled",
      updatedAt: now,
      ...(dispatchBatchId ? { dispatchBatchId: null, batchSequence: null } : {}),
    });

    if (registryRef) {
      txn.update(registryRef, {
        activeRequestId: null,
        updatedAt: now,
        updatedBy: actorId,
      });
    }

    if (batchSync) {
      txn.update(batchSync.batchRef, { status: batchSync.status, updatedAt: now });
    }

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "request_cancelled",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { reason, ...(dispatchBatchId ? { leftDispatchBatchId: dispatchBatchId } : {}) },
    });

    if (dispatchBatchId) {
      const batchEventRef = requestRef.collection("events").doc();
      txn.set(batchEventRef, {
        type: "dispatcher_batch_membership_removed",
        actorId,
        actorRole: "dispatcher",
        createdAt: now,
        metadata: { dispatchBatchId, reason: "cancelled" },
      });
    }
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Dispute resolution
// ---------------------------------------------------------------------------

export interface ResolveDisputeCompletedInput {
  requestId: string;
  actorId: string;
  note: string;
}

/**
 * Government resolves a dispute by accepting the delivery as complete.
 * Transitions from "disputed" to "confirmed".
 */
export async function resolveDisputeCompleted(
  input: ResolveDisputeCompletedInput,
): Promise<WaterRequest> {
  const { requestId, actorId, note } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;
    if (data.status !== "disputed") {
      throw new Error("REQUEST_NOT_DISPUTED");
    }

    const assignedDriverId = data.assignedDriverId as string | null | undefined;
    let registryRef: FirebaseFirestore.DocumentReference | null = null;
    if (assignedDriverId) {
      const driverQuery = db
        .collection("driverRegistry")
        .where("linkedUserId", "==", assignedDriverId)
        .limit(1);
      const driverSnap = await txn.get(driverQuery);
      if (!driverSnap.empty && driverSnap.docs[0].data().activeRequestId === requestId) {
        registryRef = driverSnap.docs[0].ref;
      }
    }

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

    if (registryRef) {
      txn.update(registryRef, {
        activeRequestId: null,
        updatedAt: now,
        updatedBy: actorId,
      });
    }

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "dispute_resolved_completed",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { note },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

export interface ResolveDisputeReopenedInput {
  requestId: string;
  actorId: string;
  note: string;
}

/**
 * Government resolves a dispute by reopening for another delivery attempt.
 * Resets the request to "available" with no assigned driver.
 * Preserves all historical events.
 */
export async function resolveDisputeReopened(
  input: ResolveDisputeReopenedInput,
): Promise<WaterRequest> {
  const { requestId, actorId, note } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;
    if (data.status !== "disputed") {
      throw new Error("REQUEST_NOT_DISPUTED");
    }

    const assignedDriverId = data.assignedDriverId as string | null | undefined;
    let registryRef: FirebaseFirestore.DocumentReference | null = null;
    if (assignedDriverId) {
      const driverQuery = db
        .collection("driverRegistry")
        .where("linkedUserId", "==", assignedDriverId)
        .limit(1);
      const driverSnap = await txn.get(driverQuery);
      if (!driverSnap.empty && driverSnap.docs[0].data().activeRequestId === requestId) {
        registryRef = driverSnap.docs[0].ref;
      }
    }

    // Reopening returns the request to the general unassigned queue, so
    // it is no longer part of whichever batch (if any) it belonged to —
    // it was already `"disputed"` (not `"claimed"`), so this cannot
    // change the batch's derived `active`/`completed` status (see
    // `computeDispatchBatchStatus`), only its current membership.
    const dispatchBatchId = (data.dispatchBatchId as string | null) ?? null;

    txn.update(requestRef, {
      status: "available",
      assignedDriverId: null,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      availableAt: now,
      updatedAt: now,
      ...(dispatchBatchId ? { dispatchBatchId: null, batchSequence: null } : {}),
    });

    if (registryRef) {
      txn.update(registryRef, {
        activeRequestId: null,
        updatedAt: now,
        updatedBy: actorId,
      });
    }

    if (dispatchBatchId) {
      const batchEventRef = requestRef.collection("events").doc();
      txn.set(batchEventRef, {
        type: "dispatcher_batch_membership_removed",
        actorId,
        actorRole: "dispatcher",
        createdAt: now,
        metadata: { dispatchBatchId, reason: "dispute_reopened" },
      });
    }

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "dispute_resolved_reopened",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { note },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Dispatcher assignment
// ---------------------------------------------------------------------------

export interface DispatcherAssignInput {
  requestId: string;
  driverId: string;
  actorId: string;
}

/**
 * Dispatcher manually assigns a request to an eligible driver.
 * Does not require the driver to be online.
 */
export async function dispatcherAssign(
  input: DispatcherAssignInput,
): Promise<WaterRequest> {
  const { requestId, driverId, actorId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const driverQuery = db
    .collection("driverRegistry")
    .where("linkedUserId", "==", driverId)
    .limit(1);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [requestSnap, driverQuerySnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(driverQuery),
    ]);

    if (!requestSnap.exists) throw new Error("REQUEST_NOT_FOUND");
    const reqData = requestSnap.data()!;

    // Only assign requests that are in an assignable state.
    const assignable: WaterRequestStatus[] = ["available", "preferred_driver_hold"];
    if (!assignable.includes(reqData.status)) {
      throw new Error("REQUEST_NOT_ASSIGNABLE");
    }

    if (driverQuerySnap.empty) throw new Error("DRIVER_NOT_FOUND");
    const drvData = driverQuerySnap.docs[0].data();
    const registryRef = driverQuerySnap.docs[0].ref;
    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }

    // One-active-delivery invariant: dispatchers may not stack assignments.
    const activeRequestId = drvData.activeRequestId ?? null;
    if (!activeRequestId) {
      const activeClaimSnap = await txn.get(
        db
          .collection(REQUESTS_COLLECTION)
          .where("assignedDriverId", "==", driverId)
          .where("status", "==", "claimed")
          .limit(1),
      );
      if (!activeClaimSnap.empty) {
        throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
      }
    }
    if (activeRequestId && activeRequestId !== requestId) {
      throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
    }

    txn.update(requestRef, {
      assignedDriverId: driverId,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
    });

    txn.update(registryRef, {
      activeRequestId: requestId,
      updatedAt: now,
      updatedBy: actorId,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "dispatcher_assigned",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { driverId },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Dispatcher reassignment
// ---------------------------------------------------------------------------

export interface DispatcherReassignInput {
  requestId: string;
  newDriverId: string;
  actorId: string;
  reason: string;
}

/**
 * Dispatcher reassigns a currently claimed request to a different driver.
 * Preserves assignment history via the audit event.
 */
export async function dispatcherReassign(
  input: DispatcherReassignInput,
): Promise<WaterRequest> {
  const { requestId, newDriverId, actorId, reason } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const newDriverQuery = db
    .collection("driverRegistry")
    .where("linkedUserId", "==", newDriverId)
    .limit(1);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [requestSnap, newDriverQuerySnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(newDriverQuery),
    ]);

    if (!requestSnap.exists) throw new Error("REQUEST_NOT_FOUND");
    const reqData = requestSnap.data()!;

    if (reqData.status !== "claimed") {
      throw new Error("REQUEST_NOT_CLAIMED");
    }

    if (newDriverQuerySnap.empty) throw new Error("DRIVER_NOT_FOUND");
    const newDrvData = newDriverQuerySnap.docs[0].data();
    const newRegistryRef = newDriverQuerySnap.docs[0].ref;
    if (newDrvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }

    const previousDriverId = reqData.assignedDriverId;

    // One-active-delivery invariant: target driver must not already have a
    // different active delivery. If the target is already assigned to this
    // request, the reassignment is a no-op assignment-wise.
    const activeRequestId = newDrvData.activeRequestId ?? null;
    if (!activeRequestId) {
      const activeClaimSnap = await txn.get(
        db
          .collection(REQUESTS_COLLECTION)
          .where("assignedDriverId", "==", newDriverId)
          .where("status", "==", "claimed")
          .limit(1),
      );
      if (!activeClaimSnap.empty) {
        throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
      }
    }
    if (activeRequestId && activeRequestId !== requestId) {
      throw new Error("DRIVER_HAS_ACTIVE_DELIVERY");
    }

    // Load the previous driver's registry record so we can clear their
    // active delivery lock — but ONLY if it currently points at THIS
    // request. Before Batch Dispatch this was always true (a driver
    // could never have more than one active claim); now that a driver
    // may separately hold a genuine active claim AND unrelated batch
    // loads (which never set `activeRequestId` — see TECHNICAL.md
    // "Batch Dispatch"), an unconditional clear here could otherwise
    // release an unrelated, still-active delivery.
    let previousRegistryRef: FirebaseFirestore.DocumentReference | null = null;
    if (previousDriverId && previousDriverId !== newDriverId) {
      const previousDriverQuery = db
        .collection("driverRegistry")
        .where("linkedUserId", "==", previousDriverId)
        .limit(1);
      const previousDriverSnap = await txn.get(previousDriverQuery);
      if (!previousDriverSnap.empty && previousDriverSnap.docs[0].data().activeRequestId === requestId) {
        previousRegistryRef = previousDriverSnap.docs[0].ref;
      }
    }

    // Reassigning to a different driver detaches this request from
    // whichever batch (if any) it currently belongs to — a batch run
    // sheet reflects a specific driver's assigned loads, so moving the
    // delivery to someone else must leave that batch's membership (see
    // TECHNICAL.md "Batch Dispatch"). Reassigning "to" the SAME driver
    // it is already assigned to is a no-op here and does not detach it.
    const dispatchBatchId =
      previousDriverId !== newDriverId ? ((reqData.dispatchBatchId as string | null) ?? null) : null;
    const batchSync = dispatchBatchId
      ? await readBatchMemberStatusesForSync(txn, db, dispatchBatchId, requestId, null)
      : null;

    txn.update(requestRef, {
      assignedDriverId: newDriverId,
      claimedAt: now,
      updatedAt: now,
      ...(dispatchBatchId ? { dispatchBatchId: null, batchSequence: null } : {}),
    });

    txn.update(newRegistryRef, {
      activeRequestId: requestId,
      updatedAt: now,
      updatedBy: actorId,
    });

    if (previousRegistryRef) {
      txn.update(previousRegistryRef, {
        activeRequestId: null,
        updatedAt: now,
        updatedBy: actorId,
      });
    }

    if (batchSync) {
      txn.update(batchSync.batchRef, { status: batchSync.status, updatedAt: now });
    }

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "dispatcher_reassigned",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: {
        previousDriverId,
        newDriverId,
        reason,
        ...(dispatchBatchId ? { leftDispatchBatchId: dispatchBatchId } : {}),
      },
    });

    if (dispatchBatchId) {
      const batchEventRef = requestRef.collection("events").doc();
      txn.set(batchEventRef, {
        type: "dispatcher_batch_membership_removed",
        actorId,
        actorRole: "dispatcher",
        createdAt: now,
        metadata: { dispatchBatchId, reason: "reassigned_to_another_driver" },
      });
    }
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}
