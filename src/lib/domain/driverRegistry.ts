import "server-only";

import { createHash } from "node:crypto";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { toUserRoles } from "@/lib/auth/roles";

import type {
  DriverAvailabilityStatus,
  DriverEvent,
  DriverRegistryEntry,
  FillStationId,
  MeterAssignment,
} from "./types";
import {
  checkActiveRequestValidity,
  type StaleReason,
} from "./activeRequestValidation";

/**
 * Government-managed Driver Registry (see PRODUCT.md / TECHNICAL.md
 * "Driver Registry"). A driver is a government entity, entered and
 * managed by staff — never self-created by a user account merely
 * receiving the `driver` role. A registry entry can exist entirely on
 * its own before the person ever creates or signs into an application
 * account.
 *
 * Canonical driver ID: this module's `driverId` (the `driverRegistry`
 * document ID) identifies the driver for admin/meter/eligibility
 * management. Operational references (`waterRequests.assignedDriverId`/
 * `preferredDriverId`, `driverOffers.driverId`) remain the linked user's
 * Firebase uid, because every operational action (accept/decline/claim)
 * inherently requires an authenticated session — see the module doc on
 * `DriverRegistryEntry` in src/lib/domain/types.ts for the full
 * rationale. `linkedUserId` is the bridge between the two.
 */

const REGISTRY_COLLECTION = "driverRegistry";
const UNIQUE_KEYS_COLLECTION = "driverRegistryUniqueKeys";
const USERS_COLLECTION = "users";
const REQUESTS_COLLECTION = "waterRequests";

function driverUniqueKey(type: "name" | "phone", value: string) {
  const digest = createHash("sha256").update(value).digest("hex");
  return `${type}_${digest}`;
}

function toDriverRegistryEntry(id: string, data: DocumentData): DriverRegistryEntry {
  return {
    id,
    displayName: data.displayName ?? "",
    phone: data.phone ?? null,
    linkedUserId: data.linkedUserId ?? null,
    eligibilityStatus: data.eligibilityStatus ?? "ineligible",
    availabilityStatus: data.availabilityStatus ?? "offline",
    ineligibilityReason: data.ineligibilityReason ?? null,
    restrictedAt: data.restrictedAt?.toDate?.().toISOString() ?? null,
    restrictedBy: data.restrictedBy ?? null,
    cooldownUntil: data.cooldownUntil?.toDate?.().toISOString() ?? null,
    activeRequestId: data.activeRequestId ?? null,
    archivedAt: data.archivedAt?.toDate?.().toISOString() ?? null,
    archivedBy: data.archivedBy ?? null,
    archiveReason: data.archiveReason ?? null,
    archivedPreviousEligibilityStatus: data.archivedPreviousEligibilityStatus ?? null,
    archivedPreviousIneligibilityReason: data.archivedPreviousIneligibilityReason ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    createdBy: data.createdBy ?? "",
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedBy: data.updatedBy ?? "",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function activeDeliveryCountForUser(userId: string): Promise<number> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("assignedDriverId", "==", userId)
    .where("status", "==", "claimed")
    .get();
  return snapshot.size;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getDriver(driverId: string): Promise<DriverRegistryEntry | null> {
  const db = getAdminDb();
  const doc = await db.collection(REGISTRY_COLLECTION).doc(driverId).get();
  if (!doc.exists) return null;
  return toDriverRegistryEntry(doc.id, doc.data()!);
}

export async function getDriverByLinkedUserId(
  userId: string,
): Promise<DriverRegistryEntry | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REGISTRY_COLLECTION)
    .where("linkedUserId", "==", userId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return toDriverRegistryEntry(snapshot.docs[0].id, snapshot.docs[0].data());
}

/**
 * True if the linked driver could claim a request RIGHT NOW: registry
 * entry exists, is linked, eligible, online, and not in a decline
 * cooldown. Used to decide whether a preferred-driver preference gets
 * exclusive dispatch access for an Urgent/Critical request, or whether
 * it must be bypassed so the request reaches the general queue without
 * delay — see PRODUCT.md "Preferred Driver Offline Edge Case".
 */
export async function isDriverImmediatelyAvailable(userId: string): Promise<boolean> {
  const entry = await getDriverByLinkedUserId(userId);
  if (!entry) return false;
  if (entry.archivedAt) return false;
  if (entry.eligibilityStatus !== "eligible") return false;
  if (entry.availabilityStatus !== "online") return false;
  if (entry.cooldownUntil && new Date(entry.cooldownUntil) > new Date()) return false;
  if (entry.activeRequestId) {
    // Reconcile before blocking — the lock may be stale.
    const result = await reconcileActiveRequest(entry.id);
    if (!result.repaired) return false;
    // Lock was stale and cleared; driver is available.
  }
  return true;
}

export async function getAllDriverRegistryEntries(): Promise<DriverRegistryEntry[]> {
  const db = getAdminDb();
  const snapshot = await db.collection(REGISTRY_COLLECTION).get();
  const entries = snapshot.docs.map((doc) => toDriverRegistryEntry(doc.id, doc.data()));
  entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return entries;
}

export async function getActiveDriverRegistryEntries(): Promise<DriverRegistryEntry[]> {
  const all = await getAllDriverRegistryEntries();
  return all.filter((d) => !d.archivedAt);
}

export async function getArchivedDriverRegistryEntries(): Promise<DriverRegistryEntry[]> {
  const all = await getAllDriverRegistryEntries();
  return all.filter((d) => d.archivedAt);
}

/** Lightweight option for the preferred-driver picker and assign/reassign pickers. */
export interface EligibleDriverOption {
  uid: string;
  displayName: string;
}

/**
 * Returns eligible, account-linked drivers only. Unlinked drivers
 * cannot appear here even if marked eligible — there is no authenticated
 * account for a resident/dispatcher to hand a request to yet.
 */
export async function getEligibleDriverOptions(): Promise<EligibleDriverOption[]> {
  const entries = await getAllDriverRegistryEntries();
  return entries
    .filter((d) => d.eligibilityStatus === "eligible" && d.linkedUserId && !d.archivedAt)
    .map((d) => ({ uid: d.linkedUserId as string, displayName: d.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// Create / update basic info
// ---------------------------------------------------------------------------

export interface CreateDriverInput {
  displayName: string;
  phone: string | null;
  actorId: string;
}

export async function createDriver(input: CreateDriverInput): Promise<DriverRegistryEntry> {
  const { displayName, phone, actorId } = input;
  if (!displayName.trim()) throw new Error("DISPLAY_NAME_REQUIRED");

  const normalizedName = displayName.trim().toLocaleLowerCase();
  const normalizedPhone = phone?.replace(/\D/g, "") || null;
  const existing = await getAllDriverRegistryEntries();
  if (existing.some((driver) => driver.displayName.trim().toLocaleLowerCase() === normalizedName)) {
    throw new Error("DRIVER_NAME_EXISTS");
  }
  if (normalizedPhone && existing.some((driver) => driver.phone?.replace(/\D/g, "") === normalizedPhone)) {
    throw new Error("DRIVER_PHONE_EXISTS");
  }

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc();
  const nameKeyRef = db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("name", normalizedName));
  const phoneKeyRef = normalizedPhone
    ? db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("phone", normalizedPhone))
    : null;
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const [nameKey, phoneKey] = await Promise.all([
      txn.get(nameKeyRef),
      phoneKeyRef ? txn.get(phoneKeyRef) : Promise.resolve(null),
    ]);
    if (nameKey.exists) throw new Error("DRIVER_NAME_EXISTS");
    if (phoneKey?.exists) throw new Error("DRIVER_PHONE_EXISTS");

    txn.create(nameKeyRef, { driverId: ref.id, type: "name", createdAt: now });
    if (phoneKeyRef) txn.create(phoneKeyRef, { driverId: ref.id, type: "phone", createdAt: now });
    txn.create(ref, {
      displayName: displayName.trim(),
      phone: phone?.trim() || null,
      linkedUserId: null,
      eligibilityStatus: "ineligible",
      availabilityStatus: "offline",
      ineligibilityReason: "Pending government approval",
      restrictedAt: null,
      restrictedBy: null,
      cooldownUntil: null,
      activeRequestId: null,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    });
    txn.create(ref.collection("events").doc(), {
      type: "driver_registry_created",
      actorId,
      actorRole: "admin",
      createdAt: now,
      metadata: { displayName: displayName.trim() },
    });
  });

  const created = await ref.get();
  return toDriverRegistryEntry(ref.id, created.data()!);
}

export interface UpdateDriverInput {
  driverId: string;
  displayName: string;
  phone: string | null;
  actorId: string;
}

export async function updateDriver(input: UpdateDriverInput): Promise<DriverRegistryEntry> {
  const { driverId, displayName, phone, actorId } = input;
  if (!displayName.trim()) throw new Error("DISPLAY_NAME_REQUIRED");

  const normalizedName = displayName.trim().toLocaleLowerCase();
  const normalizedPhone = phone?.replace(/\D/g, "") || null;
  const existing = await getAllDriverRegistryEntries();
  if (existing.some((driver) => driver.id !== driverId && driver.displayName.trim().toLocaleLowerCase() === normalizedName)) {
    throw new Error("DRIVER_NAME_EXISTS");
  }
  if (normalizedPhone && existing.some((driver) => driver.id !== driverId && driver.phone?.replace(/\D/g, "") === normalizedPhone)) {
    throw new Error("DRIVER_PHONE_EXISTS");
  }

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const newNameKeyRef = db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("name", normalizedName));
  const newPhoneKeyRef = normalizedPhone
    ? db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("phone", normalizedPhone))
    : null;
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    const doc = await txn.get(ref);
    if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
    const previous = toDriverRegistryEntry(driverId, doc.data()!);
    const previousName = previous.displayName.trim().toLocaleLowerCase();
    const previousPhone = previous.phone?.replace(/\D/g, "") || null;
    const oldNameKeyRef = db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("name", previousName));
    const oldPhoneKeyRef = previousPhone
      ? db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("phone", previousPhone))
      : null;
    const [newNameKey, newPhoneKey, oldNameKey, oldPhoneKey] = await Promise.all([
      txn.get(newNameKeyRef),
      newPhoneKeyRef ? txn.get(newPhoneKeyRef) : Promise.resolve(null),
      txn.get(oldNameKeyRef),
      oldPhoneKeyRef ? txn.get(oldPhoneKeyRef) : Promise.resolve(null),
    ]);
    if (newNameKey.exists && newNameKey.data()?.driverId !== driverId) throw new Error("DRIVER_NAME_EXISTS");
    if (newPhoneKey?.exists && newPhoneKey.data()?.driverId !== driverId) throw new Error("DRIVER_PHONE_EXISTS");

    txn.set(newNameKeyRef, { driverId, type: "name", updatedAt: now });
    if (newPhoneKeyRef) txn.set(newPhoneKeyRef, { driverId, type: "phone", updatedAt: now });
    if (oldNameKeyRef.path !== newNameKeyRef.path && oldNameKey.exists && oldNameKey.data()?.driverId === driverId) {
      txn.delete(oldNameKeyRef);
    }
    if (oldPhoneKeyRef && oldPhoneKeyRef.path !== newPhoneKeyRef?.path && oldPhoneKey?.exists && oldPhoneKey.data()?.driverId === driverId) {
      txn.delete(oldPhoneKeyRef);
    }
    txn.update(ref, {
      displayName: displayName.trim(),
      phone: phone?.trim() || null,
      updatedAt: now,
      updatedBy: actorId,
    });
    txn.create(ref.collection("events").doc(), {
      type: "driver_registry_updated",
      actorId,
      actorRole: "admin",
      createdAt: now,
      metadata: {
        previous: { displayName: previous.displayName, phone: previous.phone },
        updated: { displayName: displayName.trim(), phone: phone?.trim() || null },
      },
    });
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------

export interface LinkDriverAccountInput {
  driverId: string;
  userId: string;
  actorId: string;
}

/**
 * Links an existing application user account to a driver registry
 * entry. Adds the `driver` role (preserving all existing roles) but
 * deliberately does NOT grant eligibility — that remains a separate,
 * explicit government decision. Enforced server-side: a user account
 * cannot end up linked to more than one driver record.
 */
export async function linkDriverAccount(
  input: LinkDriverAccountInput,
): Promise<DriverRegistryEntry> {
  const { driverId, userId, actorId } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const userRef = db.collection(USERS_COLLECTION).doc(userId);

  await db.runTransaction(async (txn) => {
    // ---- All reads first ----
    const doc = await txn.get(ref);
    if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
    const data = doc.data()!;
    if (data.linkedUserId) throw new Error("DRIVER_ALREADY_LINKED");

    const userDoc = await txn.get(userRef);
    if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

    const existingLinkSnap = await txn.get(
      db
        .collection(REGISTRY_COLLECTION)
        .where("linkedUserId", "==", userId)
        .limit(1),
    );
    if (!existingLinkSnap.empty) throw new Error("USER_ALREADY_LINKED");

    const userData = userDoc.data()!;
    const currentRoles = toUserRoles(userData.roles);
    const alreadyHasDriver = currentRoles.includes("driver");

    // ---- All writes after reads ----
    const now = FieldValue.serverTimestamp();

    txn.update(ref, {
      linkedUserId: userId,
      updatedAt: now,
      updatedBy: actorId,
    });

    const registryEventRef = ref.collection("events").doc();
    txn.set(registryEventRef, {
      type: "driver_account_linked",
      actorId,
      actorRole: "admin",
      createdAt: now,
      metadata: { userId },
    });

    // Add the driver role and audit it, unless it is already present.
    if (!alreadyHasDriver) {
      const newRoles = [...currentRoles, "driver"];
      txn.update(userRef, {
        roles: newRoles,
        role: FieldValue.delete(),
        updatedAt: now,
      });

      const userEventRef = userRef.collection("roleEvents").doc();
      txn.set(userEventRef, {
        type: "role_added",
        role: "driver",
        actorId,
        createdAt: now,
      });
    }
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

export interface UnlinkDriverAccountInput {
  driverId: string;
  actorId: string;
}

/**
 * Unlinks a driver's account. Blocked while the linked driver has active
 * claimed deliveries — those must be resolved/reassigned first (same
 * guard as removing the `driver` role directly). Preserves the registry
 * record, driver history, and delivery history; only clears the link and
 * forces the driver offline.
 */
export async function unlinkDriverAccount(
  input: UnlinkDriverAccountInput,
): Promise<DriverRegistryEntry> {
  const { driverId, actorId } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);

  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const data = doc.data()!;
  const linkedUserId = data.linkedUserId as string | null;
  if (!linkedUserId) throw new Error("DRIVER_NOT_LINKED");

  const activeCount = await activeDeliveryCountForUser(linkedUserId);
  if (activeCount > 0) throw new Error("DRIVER_HAS_ACTIVE_DELIVERIES");

  const userRef = db.collection(USERS_COLLECTION).doc(linkedUserId);

  await db.runTransaction(async (txn) => {
    // ---- All reads first ----
    const driverSnap = await txn.get(ref);
    if (!driverSnap.exists) throw new Error("DRIVER_NOT_FOUND");
    const driverData = driverSnap.data()!;
    const currentLinkedUserId = driverData.linkedUserId as string | null;
    if (!currentLinkedUserId) throw new Error("DRIVER_NOT_LINKED");

    const userSnap = await txn.get(userRef);
    if (!userSnap.exists) throw new Error("USER_NOT_FOUND");

    const userData = userSnap.data()!;
    const currentRoles = toUserRoles(userData.roles);
    const hasDriver = currentRoles.includes("driver");

    // ---- All writes after reads ----
    const now = FieldValue.serverTimestamp();

    txn.update(ref, {
      linkedUserId: null,
      availabilityStatus: "offline",
      updatedAt: now,
      updatedBy: actorId,
    });

    const registryEventRef = ref.collection("events").doc();
    txn.set(registryEventRef, {
      type: "driver_account_unlinked",
      actorId,
      actorRole: "admin",
      createdAt: now,
      metadata: { userId: linkedUserId },
    });

    // Remove the driver role and audit it, if it is still present.
    if (hasDriver) {
      const newRoles = currentRoles.filter((r) => r !== "driver");
      txn.update(userRef, {
        roles: newRoles,
        role: FieldValue.delete(),
        updatedAt: now,
      });

      const userEventRef = userRef.collection("roleEvents").doc();
      txn.set(userEventRef, {
        type: "role_removed",
        role: "driver",
        actorId,
        createdAt: now,
      });
    }
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Eligibility (restrict / restore)
// ---------------------------------------------------------------------------

export interface RestrictDriverInput {
  driverId: string;
  restrictedBy: string;
  reason: string;
}

export async function restrictDriver(input: RestrictDriverInput): Promise<DriverRegistryEntry> {
  const { driverId, restrictedBy, reason } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");

  const now = FieldValue.serverTimestamp();
  await ref.update({
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: reason,
    restrictedAt: now,
    restrictedBy,
    updatedAt: now,
    updatedBy: restrictedBy,
  });

  await ref.collection("events").add({
    type: "driver_access_restricted",
    actorId: restrictedBy,
    actorRole: "admin",
    createdAt: now,
    metadata: { reason },
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

export interface RestoreDriverInput {
  driverId: string;
  restoredBy: string;
}

export async function restoreDriver(input: RestoreDriverInput): Promise<DriverRegistryEntry> {
  const { driverId, restoredBy } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");

  const now = FieldValue.serverTimestamp();
  await ref.update({
    eligibilityStatus: "eligible",
    ineligibilityReason: null,
    restrictedAt: null,
    restrictedBy: null,
    updatedAt: now,
    updatedBy: restoredBy,
  });

  await ref.collection("events").add({
    type: "driver_access_restored",
    actorId: restoredBy,
    actorRole: "admin",
    createdAt: now,
    metadata: null,
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

// ---------------------------------------------------------------------------
// Archive / restore
// ---------------------------------------------------------------------------

export interface ArchiveDriverInput {
  driverId: string;
  archivedBy: string;
  reason: string;
}

export async function archiveDriver(input: ArchiveDriverInput): Promise<DriverRegistryEntry> {
  const { driverId, archivedBy, reason } = input;
  if (!reason.trim()) throw new Error("ARCHIVE_REASON_REQUIRED");

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const data = doc.data()!;
  if (data.archivedAt) throw new Error("DRIVER_ALREADY_ARCHIVED");

  const activeRequestId: string | null = data.activeRequestId ?? null;
  if (activeRequestId) {
    const reconcile = await reconcileActiveRequest(driverId);
    if (!reconcile.repaired) throw new Error("DRIVER_HAS_ACTIVE_REQUEST");
  }

  const linkedUserId: string | null = data.linkedUserId ?? null;
  if (linkedUserId) {
    const activeCount = await activeDeliveryCountForUser(linkedUserId);
    if (activeCount > 0) throw new Error("DRIVER_HAS_ACTIVE_DELIVERIES");
  }

  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("DRIVER_NOT_FOUND");
    const current = snap.data()!;
    if (current.archivedAt) throw new Error("DRIVER_ALREADY_ARCHIVED");
    if (current.activeRequestId) throw new Error("DRIVER_HAS_ACTIVE_REQUEST");

    const previousEligibility = (current.eligibilityStatus ?? "ineligible") as DriverEligibilityStatus;
    const previousReason = (current.ineligibilityReason ?? null) as string | null;

    txn.update(ref, {
      eligibilityStatus: "ineligible",
      availabilityStatus: "offline",
      ineligibilityReason: `Archived: ${reason.trim()}`,
      archivedAt: now,
      archivedBy,
      archiveReason: reason.trim(),
      archivedPreviousEligibilityStatus: previousEligibility,
      archivedPreviousIneligibilityReason: previousReason,
      updatedAt: now,
      updatedBy: archivedBy,
    });
    txn.create(ref.collection("events").doc(), {
      type: "driver_archived",
      actorId: archivedBy,
      actorRole: "admin",
      createdAt: now,
      metadata: {
        reason: reason.trim(),
        previousEligibilityStatus: previousEligibility,
        previousIneligibilityReason: previousReason,
      },
    });
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

export interface RestoreArchivedDriverInput {
  driverId: string;
  restoredBy: string;
}

export async function restoreArchivedDriver(input: RestoreArchivedDriverInput): Promise<DriverRegistryEntry> {
  const { driverId, restoredBy } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const data = doc.data()!;
  if (!data.archivedAt) throw new Error("DRIVER_NOT_ARCHIVED");

  const now = FieldValue.serverTimestamp();
  const previousEligibility = (data.archivedPreviousEligibilityStatus ?? "ineligible") as DriverEligibilityStatus;
  const previousReason = (data.archivedPreviousIneligibilityReason ?? null) as string | null;

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("DRIVER_NOT_FOUND");
    const current = snap.data()!;
    if (!current.archivedAt) throw new Error("DRIVER_NOT_ARCHIVED");

    txn.update(ref, {
      eligibilityStatus: previousEligibility,
      ineligibilityReason: previousReason,
      availabilityStatus: "offline",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      archivedPreviousEligibilityStatus: null,
      archivedPreviousIneligibilityReason: null,
      updatedAt: now,
      updatedBy: restoredBy,
    });
    txn.create(ref.collection("events").doc(), {
      type: "driver_restored_from_archive",
      actorId: restoredBy,
      actorRole: "admin",
      createdAt: now,
      metadata: {
        restoredToEligibilityStatus: previousEligibility,
      },
    });
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

export interface DeleteDriverEligibility {
  canDelete: boolean;
  reasons: string[];
  summary: {
    displayName: string;
    linkedAccount: boolean;
    activeRequestLock: boolean;
    activeAssignments: number;
    historicalAssignments: number;
    preferredDriverReferences: number;
    dispatchBatchMemberships: number;
    driverOfferReferences: number;
    meterAssignments: number;
    registryEvents: number;
  };
}

const ACTIVE_REQUEST_STATUSES: WaterRequestStatus[] = ["claimed", "preferred_driver_hold"];

async function getReferenceCounts(linkedUserId: string | null) {
  const db = getAdminDb();
  if (!linkedUserId) {
    return {
      activeAssignments: 0,
      historicalAssignments: 0,
      preferredDriverReferences: 0,
      dispatchBatchMemberships: 0,
      driverOfferReferences: 0,
    };
  }

  const BATCHES_COLLECTION = "dispatchBatches";
  const OFFERS_COLLECTION = "driverOffers";

  const [assignmentsSnap, preferredSnap, batchesSnap, offersSnap] = await Promise.all([
    db.collection(REQUESTS_COLLECTION).where("assignedDriverId", "==", linkedUserId).get(),
    db.collection(REQUESTS_COLLECTION).where("preferredDriverId", "==", linkedUserId).get(),
    db.collection(BATCHES_COLLECTION).where("driverId", "==", linkedUserId).get(),
    db.collection(OFFERS_COLLECTION).where("driverId", "==", linkedUserId).get(),
  ]);

  const activeStatuses = new Set(ACTIVE_REQUEST_STATUSES as string[]);
  const activeAssignments = assignmentsSnap.docs.filter((d) => activeStatuses.has(d.data().status)).length;

  return {
    activeAssignments,
    historicalAssignments: assignmentsSnap.size,
    preferredDriverReferences: preferredSnap.size,
    dispatchBatchMemberships: batchesSnap.size,
    driverOfferReferences: offersSnap.size,
  };
}

export async function getDeleteDriverEligibility(driverId: string): Promise<DeleteDriverEligibility> {
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");

  const data = doc.data()!;
  const linkedUserId: string | null = data.linkedUserId ?? null;

  const [metersSnap, eventsSnap, references] = await Promise.all([
    ref.collection("meters").get(),
    ref.collection("events").get(),
    getReferenceCounts(linkedUserId),
  ]);

  const activeRequestLock = Boolean(data.activeRequestId);
  const linkedAccount = Boolean(linkedUserId);
  const meterAssignments = metersSnap.size;
  const registryEvents = eventsSnap.size;

  const reasons: string[] = [];
  if (linkedAccount) {
    reasons.push(
      "This driver has a linked application account. Unlink it first; delete the Firebase Auth account separately if required.",
    );
  }
  if (activeRequestLock) {
    reasons.push("This driver has an active request lock.");
  }
  if (references.activeAssignments > 0) {
    reasons.push(`This driver has ${references.activeAssignments} active assigned request(s).`);
  }
  if (references.historicalAssignments > 0) {
    reasons.push(
      `Cannot permanently delete this driver because ${references.historicalAssignments} historical water request(s) reference this record. Archive the driver instead.`,
    );
  }
  if (references.preferredDriverReferences > 0) {
    reasons.push(`${references.preferredDriverReferences} request(s) list this driver as preferred.`);
  }
  if (references.dispatchBatchMemberships > 0) {
    reasons.push(`${references.dispatchBatchMemberships} dispatch batch(es) reference this driver.`);
  }
  if (references.driverOfferReferences > 0) {
    reasons.push(`${references.driverOfferReferences} dispatch offer(s) reference this driver.`);
  }
  if (meterAssignments > 0) {
    reasons.push(`${meterAssignments} meter assignment(s) exist. Remove them first or archive the driver.`);
  }
  if (registryEvents > 0) {
    reasons.push(
      `Cannot permanently delete this driver because the registry audit trail contains ${registryEvents} event(s). Archive the driver instead.`,
    );
  }

  return {
    canDelete: reasons.length === 0,
    reasons,
    summary: {
      displayName: data.displayName ?? "",
      linkedAccount,
      activeRequestLock,
      activeAssignments: references.activeAssignments,
      historicalAssignments: references.historicalAssignments,
      preferredDriverReferences: references.preferredDriverReferences,
      dispatchBatchMemberships: references.dispatchBatchMemberships,
      driverOfferReferences: references.driverOfferReferences,
      meterAssignments,
      registryEvents,
    },
  };
}

export interface DeleteDriverInput {
  driverId: string;
  deletedBy: string;
  confirmation: string;
}

export async function deleteDriver(input: DeleteDriverInput): Promise<void> {
  const { driverId, deletedBy, confirmation } = input;
  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);

  const eligibility = await getDeleteDriverEligibility(driverId);
  if (!eligibility.canDelete) throw new Error("DRIVER_NOT_ELIGIBLE_FOR_DELETION");

  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const data = doc.data()!;
  const displayName = (data.displayName ?? "").trim();

  if (confirmation.trim().toLowerCase() !== displayName.toLowerCase()) {
    throw new Error("CONFIRMATION_NAME_MISMATCH");
  }

  const normalizedName = displayName.toLowerCase();
  const normalizedPhone = (data.phone?.replace(/\D/g, "") || null) as string | null;
  const nameKeyRef = db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("name", normalizedName));
  const phoneKeyRef = normalizedPhone
    ? db.collection(UNIQUE_KEYS_COLLECTION).doc(driverUniqueKey("phone", normalizedPhone))
    : null;

  const [meters, events] = await Promise.all([ref.collection("meters").get(), ref.collection("events").get()]);

  const batch = db.batch();
  batch.delete(ref);
  batch.delete(nameKeyRef);
  if (phoneKeyRef) batch.delete(phoneKeyRef);
  meters.docs.forEach((m) => batch.delete(m.ref));
  events.docs.forEach((e) => batch.delete(e.ref));

  await batch.commit();
}

// ---------------------------------------------------------------------------
// Availability / cooldown (by linked user — called from the driver portal)
// ---------------------------------------------------------------------------

export interface SetAvailabilityByLinkedUserInput {
  userId: string;
  availabilityStatus: DriverAvailabilityStatus;
}

export async function setAvailabilityByLinkedUser(
  input: SetAvailabilityByLinkedUserInput,
): Promise<DriverRegistryEntry> {
  const { userId, availabilityStatus } = input;
  const entry = await getDriverByLinkedUserId(userId);
  if (!entry) throw new Error("DRIVER_NOT_FOUND");

  if (availabilityStatus === "online" && entry.eligibilityStatus !== "eligible") {
    throw new Error("DRIVER_INELIGIBLE");
  }
  if (availabilityStatus === "online" && entry.cooldownUntil) {
    if (new Date(entry.cooldownUntil) > new Date()) {
      throw new Error("DRIVER_IN_COOLDOWN");
    }
  }

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(entry.id);
  const now = FieldValue.serverTimestamp();
  await ref.update({ availabilityStatus, updatedAt: now, updatedBy: userId });

  await ref.collection("events").add({
    type: availabilityStatus === "online" ? "driver_online" : "driver_offline",
    actorId: userId,
    actorRole: "driver",
    createdAt: now,
    metadata: null,
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(entry.id, updated.data()!);
}

export interface StartCooldownByLinkedUserInput {
  userId: string;
  cooldownUntil: Date;
  declineCount: number;
  maxDeclinesPerDay: number;
}

export async function startCooldownByLinkedUser(
  input: StartCooldownByLinkedUserInput,
): Promise<DriverRegistryEntry> {
  const { userId, cooldownUntil, declineCount, maxDeclinesPerDay } = input;
  const entry = await getDriverByLinkedUserId(userId);
  if (!entry) throw new Error("DRIVER_NOT_FOUND");

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(entry.id);
  const now = FieldValue.serverTimestamp();

  await ref.update({ cooldownUntil, updatedAt: now, updatedBy: userId });

  await ref.collection("events").add({
    type: "driver_cooldown_started",
    actorId: userId,
    actorRole: "driver",
    createdAt: now,
    metadata: {
      declineCount,
      maxDeclinesPerDay,
      cooldownUntil: cooldownUntil.toISOString(),
    },
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(entry.id, updated.data()!);
}

// ---------------------------------------------------------------------------
// Event history
// ---------------------------------------------------------------------------

export async function getDriverEvents(driverId: string): Promise<DriverEvent[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REGISTRY_COLLECTION)
    .doc(driverId)
    .collection("events")
    .orderBy("createdAt", "desc")
    .limit(100)
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
// Stale activeRequestId reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  /** Whether a stale lock was found and cleared. */
  repaired: boolean;
  /** The stale request ID that was cleared, if any. */
  staleRequestId?: string;
  /** Why the lock was considered stale. */
  reason?: StaleReason;
}

/**
 * Validates a driver's `activeRequestId` lock against the actual request
 * state and clears it if stale. This is the **single canonical entry
 * point** for stale-lock reconciliation — call sites must not scatter
 * this logic elsewhere.
 *
 * A lock is stale when the referenced request no longer represents
 * active driver work: the request is missing (deleted), delivered,
 * confirmed, cancelled, disputed, reassigned away, or returned to an
 * un-owned state. See `activeRequestValidation.ts` for the full rule.
 *
 * When a stale lock is repaired the function:
 *   1. Clears `activeRequestId` on the registry document.
 *   2. Records a `stale_active_request_cleared` audit event with the
 *      stale request ID, reason, and `actor: "system"`.
 *
 * Call this before any operation that would be blocked by
 * `activeRequestId` — driver offer selection, claim, dispatcher
 * assignment, and driver portal rendering.
 *
 * @param driverId  The registry document ID (NOT the Firebase uid).
 */
export async function reconcileActiveRequest(
  driverId: string,
): Promise<ReconcileResult> {
  const db = getAdminDb();
  const driverRef = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { repaired: false };

  const driverData = driverSnap.data()!;
  const activeRequestId: string | null = driverData.activeRequestId ?? null;
  if (!activeRequestId) return { repaired: false };

  const linkedUserId: string | null = driverData.linkedUserId ?? null;
  if (!linkedUserId) {
    // Registry entry has an activeRequestId but no linked account — the
    // lock is inherently stale (no user can ever clear it normally).
    const now = FieldValue.serverTimestamp();
    await driverRef.update({ activeRequestId: null, updatedAt: now, updatedBy: "system" });
    await driverRef.collection("events").add({
      type: "stale_active_request_cleared",
      actorId: "system",
      actorRole: "system",
      createdAt: now,
      metadata: { staleRequestId: activeRequestId, reason: "not_active" as StaleReason },
    });
    return { repaired: true, staleRequestId: activeRequestId, reason: "not_active" };
  }

  // Fetch the referenced request to check validity.
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(activeRequestId);
  const requestSnap = await requestRef.get();

  const snapshot = requestSnap.exists
    ? {
        status: requestSnap.data()!.status,
        assignedDriverId: requestSnap.data()!.assignedDriverId ?? null,
      }
    : null;

  const check = checkActiveRequestValidity(linkedUserId, snapshot);
  if (!check.stale) return { repaired: false };

  const now = FieldValue.serverTimestamp();
  await driverRef.update({ activeRequestId: null, updatedAt: now, updatedBy: "system" });
  await driverRef.collection("events").add({
    type: "stale_active_request_cleared",
    actorId: "system",
    actorRole: "system",
    createdAt: now,
    metadata: { staleRequestId: activeRequestId, reason: check.reason },
  });

  return { repaired: true, staleRequestId: activeRequestId, reason: check.reason };
}

/**
 * Convenience wrapper: reconcile by linked Firebase uid instead of
 * registry document ID. Returns `{ repaired: false }` if no registry
 * entry exists for this user.
 */
export async function reconcileActiveRequestByUserId(
  userId: string,
): Promise<ReconcileResult> {
  const entry = await getDriverByLinkedUserId(userId);
  if (!entry) return { repaired: false };
  return reconcileActiveRequest(entry.id);
}

// ---------------------------------------------------------------------------
// Fill-station meter assignments
// ---------------------------------------------------------------------------

function toMeterAssignment(stationId: string, data: DocumentData): MeterAssignment {
  return {
    stationId,
    meterCode: data.meterCode ?? "",
    meterNumber: data.meterNumber ?? 0,
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedBy: data.updatedBy ?? "",
  };
}

export async function getMeterAssignments(driverId: string): Promise<MeterAssignment[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(REGISTRY_COLLECTION)
    .doc(driverId)
    .collection("meters")
    .get();
  return snapshot.docs.map((doc) => toMeterAssignment(doc.id, doc.data()));
}

export interface SetMeterAssignmentInput {
  driverId: string;
  stationId: FillStationId;
  meterCode: string;
  meterNumber: number;
  actorId: string;
}

export async function setMeterAssignment(
  input: SetMeterAssignmentInput,
): Promise<MeterAssignment> {
  const { driverId, stationId, meterCode, meterNumber, actorId } = input;
  if (!meterCode.trim()) throw new Error("METER_CODE_REQUIRED");
  if (!Number.isFinite(meterNumber) || meterNumber < 0) throw new Error("INVALID_METER_NUMBER");

  const db = getAdminDb();
  const driverRef = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const driverDoc = await driverRef.get();
  if (!driverDoc.exists) throw new Error("DRIVER_NOT_FOUND");

  const meterRef = driverRef.collection("meters").doc(stationId);
  const existing = await meterRef.get();
  const now = FieldValue.serverTimestamp();

  await meterRef.set({
    meterCode: meterCode.trim(),
    meterNumber,
    updatedAt: now,
    updatedBy: actorId,
  });

  await driverRef.collection("events").add({
    type: existing.exists ? "meter_assignment_updated" : "meter_assignment_added",
    actorId,
    actorRole: "admin",
    createdAt: now,
    metadata: {
      stationId,
      previous: existing.exists
        ? { meterCode: existing.data()!.meterCode, meterNumber: existing.data()!.meterNumber }
        : null,
      updated: { meterCode: meterCode.trim(), meterNumber },
    },
  });

  const updated = await meterRef.get();
  return toMeterAssignment(stationId, updated.data()!);
}

export interface RemoveMeterAssignmentInput {
  driverId: string;
  stationId: FillStationId;
  actorId: string;
}

export async function removeMeterAssignment(input: RemoveMeterAssignmentInput): Promise<void> {
  const { driverId, stationId, actorId } = input;
  const db = getAdminDb();
  const driverRef = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const meterRef = driverRef.collection("meters").doc(stationId);
  const existing = await meterRef.get();
  if (!existing.exists) return;

  const previous = existing.data()!;
  await meterRef.delete();

  await driverRef.collection("events").add({
    type: "meter_assignment_removed",
    actorId,
    actorRole: "admin",
    createdAt: FieldValue.serverTimestamp(),
    metadata: {
      stationId,
      previous: { meterCode: previous.meterCode, meterNumber: previous.meterNumber },
    },
  });
}

// ---------------------------------------------------------------------------
// Initial roster seed (development / one-off tooling only)
// ---------------------------------------------------------------------------
//
// Not exposed in the production admin UI. Use this from a local script or
// development command to idempotently create the known current roster.

interface SeedDriverSpec {
  displayName: string;
  meters: { stationId: FillStationId; meterCode: string; meterNumber: number }[];
}

const INITIAL_ROSTER: SeedDriverSpec[] = [
  {
    displayName: "Government",
    meters: [
      { stationId: "bottom", meterCode: "BTM1", meterNumber: 1 },
      { stationId: "wws", meterCode: "WWS1", meterNumber: 1 },
      { stationId: "hells-gate", meterCode: "HG1", meterNumber: 1 },
    ],
  },
  {
    displayName: "Shanon Levenston",
    meters: [
      { stationId: "bottom", meterCode: "BTM2", meterNumber: 2 },
      { stationId: "wws", meterCode: "WWS2", meterNumber: 2 },
      { stationId: "hells-gate", meterCode: "HG2", meterNumber: 2 },
    ],
  },
  {
    displayName: "Earl Ballentyne",
    meters: [
      { stationId: "bottom", meterCode: "BTM3", meterNumber: 3 },
      { stationId: "wws", meterCode: "WWS3", meterNumber: 3 },
      { stationId: "hells-gate", meterCode: "HG3", meterNumber: 3 },
    ],
  },
  {
    displayName: "Michael Hodge",
    meters: [
      { stationId: "bottom", meterCode: "BTM4", meterNumber: 4 },
      { stationId: "wws", meterCode: "WWS4", meterNumber: 4 },
      { stationId: "hells-gate", meterCode: "HG4", meterNumber: 4 },
    ],
  },
  {
    displayName: "Andy Lavia",
    meters: [
      { stationId: "bottom", meterCode: "BTM5", meterNumber: 5 },
      { stationId: "wws", meterCode: "WWS5", meterNumber: 5 },
      { stationId: "hells-gate", meterCode: "HG5", meterNumber: 5 },
    ],
  },
  {
    displayName: "Eagen Aquasab",
    meters: [
      { stationId: "bottom", meterCode: "BTM6", meterNumber: 6 },
      { stationId: "wws", meterCode: "WWS6", meterNumber: 6 },
      { stationId: "hells-gate", meterCode: "HG6", meterNumber: 6 },
    ],
  },
];

export interface SeedInitialRosterResult {
  created: number;
  skipped: number;
}

/**
 * Idempotently creates the known current driver roster (see PRODUCT.md
 * "Current Driver Roster") with their fill-station meter assignments, if
 * a driver with that exact display name does not already exist in the
 * registry. Must be explicitly triggered by an admin — never run
 * automatically on deploy.
 */
export async function seedInitialRoster(actorId: string): Promise<SeedInitialRosterResult> {
  const existing = await getAllDriverRegistryEntries();
  const existingNames = new Set(existing.map((d) => d.displayName.trim().toLowerCase()));

  let created = 0;
  let skipped = 0;

  for (const spec of INITIAL_ROSTER) {
    if (existingNames.has(spec.displayName.trim().toLowerCase())) {
      skipped++;
      continue;
    }

    const driver = await createDriver({ displayName: spec.displayName, phone: null, actorId });
    for (const meter of spec.meters) {
      await setMeterAssignment({
        driverId: driver.id,
        stationId: meter.stationId,
        meterCode: meter.meterCode,
        meterNumber: meter.meterNumber,
        actorId,
      });
    }
    created++;
  }

  return { created, skipped };
}
