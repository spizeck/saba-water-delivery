import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { appConfig } from "./config";
import { isDriverImmediatelyAvailable } from "./driverRegistry";
import { determineInitialDispatchPriority, priorityRankFor } from "./priority";
import type {
  DispatchPriority,
  ReportedUrgency,
  VulnerableCircumstance,
  WaterRequest,
  WaterRequestCustomerSnapshot,
  WaterRequestSource,
  WaterRequestStatus,
  WaterSituationRemainingSupply,
  WaterSituationSnapshot,
} from "./types";
import { getUserProfile } from "./users";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Statuses that mean the request is still "active" (unresolved). */
const ACTIVE_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "delivered_unconfirmed",
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
          remainingSupply:
            (data.waterSituation.remainingSupply as WaterSituationRemainingSupply) ?? null,
          personsAffected: data.waterSituation.personsAffected ?? null,
          vulnerableCircumstances:
            (data.waterSituation.vulnerableCircumstances as VulnerableCircumstance[]) ?? [],
          vulnerableOtherDetail: data.waterSituation.vulnerableOtherDetail ?? null,
          // New free-form string field, or a best-effort string conversion of
          // the legacy numeric `availableStorageGallons` for older requests.
          availableStorageCapacity:
            (data.waterSituation.availableStorageCapacity as string | undefined) ??
            (data.waterSituation.availableStorageGallons != null
              ? String(data.waterSituation.availableStorageGallons)
              : null),
          reportedUrgency: (data.waterSituation.reportedUrgency as ReportedUrgency) ?? "normal",
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
// Create
// ---------------------------------------------------------------------------

/**
 * Caller-supplied water-situation answers. See PRODUCT.md "Additional
 * Water Request Information". This is the raw form input; the stable,
 * immutable `WaterSituationSnapshot` stored on the request is derived
 * from this in `buildWaterSituationSnapshot()` below.
 */
export interface WaterSituationInput {
  /** Positive integer, or null if not provided (e.g. caller unsure). */
  personsAffected?: number | null;
  vulnerableCircumstances?: VulnerableCircumstance[];
  /** Resident-reported available cistern/storage capacity, as free-form text. */
  availableStorageCapacity?: string | null;
  reportedUrgency: ReportedUrgency;
}

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
 * Validates and normalizes raw water-situation form input into the
 * stable snapshot shape stored on the request. Throws a specific error
 * code (see callers for user-facing messages) rather than silently
 * coercing bad input.
 */
function buildWaterSituationSnapshot(input: WaterSituationInput): WaterSituationSnapshot {
  const vulnerableCircumstances = input.vulnerableCircumstances?.length
    ? input.vulnerableCircumstances
    : (["none"] as VulnerableCircumstance[]);

  if (input.personsAffected != null) {
    if (!Number.isInteger(input.personsAffected) || input.personsAffected <= 0) {
      throw new Error("INVALID_PERSONS_AFFECTED");
    }
  }

  const availableStorageCapacity = input.availableStorageCapacity?.trim() || null;

  return {
    remainingSupply: null,
    personsAffected: input.personsAffected ?? null,
    vulnerableCircumstances,
    vulnerableOtherDetail: null,
    availableStorageCapacity,
    reportedUrgency: input.reportedUrgency,
  };
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
  // entry linked to this uid, not a `drivers/{uid}` document — see
  // TECHNICAL.md "Driver Registry" for the canonical-ID rationale.
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

    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }
    if (drvData.availabilityStatus !== "online") {
      throw new Error("DRIVER_OFFLINE");
    }

    // --- Perform the claim ---
    txn.update(requestRef, {
      assignedDriverId: driverId,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
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
 */
export async function markWaterDelivered(
  input: MarkWaterDeliveredInput,
): Promise<WaterRequest> {
  const { requestId, driverId } = input;
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) throw new Error("REQUEST_NOT_FOUND");

    const data = snap.data()!;

    if (data.status !== "claimed") {
      throw new Error("REQUEST_NOT_CLAIMABLE");
    }
    if (data.assignedDriverId !== driverId) {
      throw new Error("NOT_ASSIGNED_DRIVER");
    }

    txn.update(requestRef, {
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

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
    if (data.status !== "delivered" && data.status !== "delivered_unconfirmed") {
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
    if (data.status !== "delivered" && data.status !== "delivered_unconfirmed") {
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
    if (data.status !== "delivered" && data.status !== "delivered_unconfirmed") {
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
// Delivered-unconfirmed timeout (lazy expiration)
// ---------------------------------------------------------------------------

/**
 * Checks if a "delivered" request has exceeded the confirmation window and
 * lazily transitions it to "delivered_unconfirmed" if so.
 *
 * Call this when reading a request's status for display. Does nothing if
 * the request is not in "delivered" status or if the window hasn't passed.
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

  const windowMs = appConfig.deliveryConfirmationWindowHours * 60 * 60 * 1000;
  const expiresAt = new Date(deliveredAt.getTime() + windowMs);

  if (new Date() < expiresAt) {
    // Still within confirmation window.
    return toWaterRequest(requestId, data);
  }

  // Expired — transition to delivered_unconfirmed.
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (txn) => {
    const freshSnap = await txn.get(requestRef);
    if (!freshSnap.exists) return;
    const freshData = freshSnap.data()!;

    // Only transition if still in "delivered" (prevent double-transition race).
    if (freshData.status !== "delivered") return;

    txn.update(requestRef, {
      status: "delivered_unconfirmed",
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "delivery_confirmation_expired",
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

    txn.update(requestRef, {
      status: "cancelled",
      updatedAt: now,
    });

    const eventRef = requestRef.collection("events").doc();
    txn.set(eventRef, {
      type: "request_cancelled",
      actorId,
      actorRole: "dispatcher",
      createdAt: now,
      metadata: { reason },
    });
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

    txn.update(requestRef, {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });

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

    txn.update(requestRef, {
      status: "available",
      assignedDriverId: null,
      claimedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      availableAt: now,
      updatedAt: now,
    });

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
    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }

    txn.update(requestRef, {
      assignedDriverId: driverId,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
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
  const driverQuery = db
    .collection("driverRegistry")
    .where("linkedUserId", "==", newDriverId)
    .limit(1);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [requestSnap, driverQuerySnap] = await Promise.all([
      txn.get(requestRef),
      txn.get(driverQuery),
    ]);

    if (!requestSnap.exists) throw new Error("REQUEST_NOT_FOUND");
    const reqData = requestSnap.data()!;

    if (reqData.status !== "claimed") {
      throw new Error("REQUEST_NOT_CLAIMED");
    }

    if (driverQuerySnap.empty) throw new Error("DRIVER_NOT_FOUND");
    const drvData = driverQuerySnap.docs[0].data();
    if (drvData.eligibilityStatus !== "eligible") {
      throw new Error("DRIVER_INELIGIBLE");
    }

    const previousDriverId = reqData.assignedDriverId;

    txn.update(requestRef, {
      assignedDriverId: newDriverId,
      claimedAt: now,
      updatedAt: now,
    });

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
      },
    });
  });

  const updated = await requestRef.get();
  return toWaterRequest(requestId, updated.data()!);
}
