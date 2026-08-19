import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import type {
  DriverAvailabilityStatus,
  DriverEvent,
  DriverRegistryEntry,
  FillStationId,
  MeterAssignment,
} from "./types";

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
const USERS_COLLECTION = "users";
const REQUESTS_COLLECTION = "waterRequests";

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
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    createdBy: data.createdBy ?? "",
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedBy: data.updatedBy ?? "",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (role array + role audit, duplicated locally rather than
// imported from admin.ts to avoid a circular dependency — admin.ts imports
// this module for the removeRole("driver") -> unlink integration).
// ---------------------------------------------------------------------------

async function currentUserRoles(userId: string): Promise<string[] | null> {
  const db = getAdminDb();
  const doc = await db.collection(USERS_COLLECTION).doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if (Array.isArray(data.roles) && data.roles.length > 0) return data.roles;
  if (typeof data.role === "string") return [data.role];
  return ["resident"];
}

async function addDriverRoleToUser(userId: string, actorId: string): Promise<void> {
  const db = getAdminDb();
  const roles = await currentUserRoles(userId);
  if (roles === null) throw new Error("USER_NOT_FOUND");
  if (roles.includes("driver")) return;

  const now = FieldValue.serverTimestamp();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  await userRef.update({
    roles: [...roles, "driver"],
    role: FieldValue.delete(),
    updatedAt: now,
  });
  await userRef.collection("roleEvents").add({
    type: "role_added",
    role: "driver",
    actorId,
    createdAt: now,
  });
}

async function removeDriverRoleFromUser(userId: string, actorId: string): Promise<void> {
  const db = getAdminDb();
  const roles = await currentUserRoles(userId);
  if (roles === null || !roles.includes("driver")) return;

  const now = FieldValue.serverTimestamp();
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  await userRef.update({
    roles: roles.filter((r) => r !== "driver"),
    role: FieldValue.delete(),
    updatedAt: now,
  });
  await userRef.collection("roleEvents").add({
    type: "role_removed",
    role: "driver",
    actorId,
    createdAt: now,
  });
}

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
  if (entry.eligibilityStatus !== "eligible") return false;
  if (entry.availabilityStatus !== "online") return false;
  if (entry.cooldownUntil && new Date(entry.cooldownUntil) > new Date()) return false;
  return true;
}

export async function getAllDriverRegistryEntries(): Promise<DriverRegistryEntry[]> {
  const db = getAdminDb();
  const snapshot = await db.collection(REGISTRY_COLLECTION).get();
  const entries = snapshot.docs.map((doc) => toDriverRegistryEntry(doc.id, doc.data()));
  entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return entries;
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
    .filter((d) => d.eligibilityStatus === "eligible" && d.linkedUserId)
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

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    displayName: displayName.trim(),
    phone: phone?.trim() || null,
    linkedUserId: null,
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: "Pending government approval",
    restrictedAt: null,
    restrictedBy: null,
    cooldownUntil: null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });

  await ref.collection("events").add({
    type: "driver_registry_created",
    actorId,
    actorRole: "admin",
    createdAt: now,
    metadata: { displayName: displayName.trim() },
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

  const db = getAdminDb();
  const ref = db.collection(REGISTRY_COLLECTION).doc(driverId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const previous = toDriverRegistryEntry(driverId, doc.data()!);

  const now = FieldValue.serverTimestamp();
  await ref.update({
    displayName: displayName.trim(),
    phone: phone?.trim() || null,
    updatedAt: now,
    updatedBy: actorId,
  });

  await ref.collection("events").add({
    type: "driver_registry_updated",
    actorId,
    actorRole: "admin",
    createdAt: now,
    metadata: {
      previous: { displayName: previous.displayName, phone: previous.phone },
      updated: { displayName: displayName.trim(), phone: phone?.trim() || null },
    },
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

  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");
  const data = doc.data()!;
  if (data.linkedUserId) throw new Error("DRIVER_ALREADY_LINKED");

  const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
  if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

  const existingLink = await getDriverByLinkedUserId(userId);
  if (existingLink) throw new Error("USER_ALREADY_LINKED");

  const now = FieldValue.serverTimestamp();
  await ref.update({
    linkedUserId: userId,
    updatedAt: now,
    updatedBy: actorId,
  });

  await addDriverRoleToUser(userId, actorId);

  await ref.collection("events").add({
    type: "driver_account_linked",
    actorId,
    actorRole: "admin",
    createdAt: now,
    metadata: { userId },
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

  const now = FieldValue.serverTimestamp();
  await ref.update({
    linkedUserId: null,
    availabilityStatus: "offline",
    updatedAt: now,
    updatedBy: actorId,
  });

  await removeDriverRoleFromUser(linkedUserId, actorId);

  await ref.collection("events").add({
    type: "driver_account_unlinked",
    actorId,
    actorRole: "admin",
    createdAt: now,
    metadata: { userId: linkedUserId },
  });

  const updated = await ref.get();
  return toDriverRegistryEntry(driverId, updated.data()!);
}

/**
 * Unlinks whichever driver record (if any) is linked to `userId`. Used
 * by `admin.ts`'s `removeRole("driver")` so removing the role through
 * the generic role-management UI keeps the registry consistent, without
 * requiring staff to separately visit the Driver Registry. Silently
 * does nothing if no driver is linked to this user.
 */
export async function unlinkDriverAccountByUserId(
  userId: string,
  actorId: string,
): Promise<void> {
  const entry = await getDriverByLinkedUserId(userId);
  if (!entry) return;
  await unlinkDriverAccount({ driverId: entry.id, actorId });
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
// Legacy migration (manual, admin-triggered — never automatic)
// ---------------------------------------------------------------------------

export interface ImportLegacyDriversResult {
  imported: number;
  skipped: number;
}

/**
 * One-time, idempotent import of legacy `drivers/{uid}` documents (from
 * before the Driver Registry existed) into new, linked registry entries.
 * Safe to run more than once — any uid that already has a linked
 * registry entry is skipped. Never deletes the legacy documents; see
 * TECHNICAL.md "Existing Driver Data Migration".
 *
 * This must be explicitly triggered by an admin (e.g. a button in the
 * Driver Registry admin UI) — it is never run automatically.
 */
export async function importLegacyDrivers(actorId: string): Promise<ImportLegacyDriversResult> {
  const db = getAdminDb();
  const legacySnapshot = await db.collection("drivers").get();

  let imported = 0;
  let skipped = 0;

  for (const legacyDoc of legacySnapshot.docs) {
    const uid = legacyDoc.id;
    const alreadyLinked = await getDriverByLinkedUserId(uid);
    if (alreadyLinked) {
      skipped++;
      continue;
    }

    const legacyData = legacyDoc.data();
    const userDoc = await db.collection(USERS_COLLECTION).doc(uid).get();
    const userData = userDoc.exists ? userDoc.data()! : null;

    const ref = db.collection(REGISTRY_COLLECTION).doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      displayName: userData?.displayName || "Driver",
      phone: userData?.phone ?? null,
      linkedUserId: uid,
      eligibilityStatus: legacyData.eligibilityStatus ?? "ineligible",
      availabilityStatus: legacyData.availabilityStatus ?? "offline",
      ineligibilityReason: legacyData.ineligibilityReason ?? null,
      restrictedAt: legacyData.restrictedAt ?? null,
      restrictedBy: legacyData.restrictedBy ?? null,
      cooldownUntil: legacyData.cooldownUntil ?? null,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    });

    await ref.collection("events").add({
      type: "driver_registry_created",
      actorId,
      actorRole: "admin",
      createdAt: now,
      metadata: { migratedFromLegacyDriverDoc: true, migratedFromUid: uid },
    });

    imported++;
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// Initial roster seed (manual, admin-triggered — never automatic)
// ---------------------------------------------------------------------------

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
