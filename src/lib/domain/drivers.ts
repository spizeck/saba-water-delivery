import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import type { DriverAvailabilityStatus, DriverProfile } from "./types";

/**
 * Domain/service layer for driver availability and authorization.
 *
 * See src/lib/domain/waterRequests.ts for the rationale: all mutation of
 * driver state must flow through here so web and future WhatsApp
 * interfaces share one implementation.
 */

const DRIVERS_COLLECTION = "drivers";
const USERS_COLLECTION = "users";

function toDriverProfile(data: DocumentData): DriverProfile {
  return {
    userId: data.userId,
    eligibilityStatus: data.eligibilityStatus ?? "ineligible",
    availabilityStatus: data.availabilityStatus ?? "offline",
    ineligibilityReason: data.ineligibilityReason ?? null,
    restrictedAt: data.restrictedAt?.toDate?.().toISOString() ?? null,
    restrictedBy: data.restrictedBy ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns the driver profile for the given uid, or null if not found.
 */
export async function getDriverProfile(
  driverId: string,
): Promise<DriverProfile | null> {
  const db = getAdminDb();
  const doc = await db.collection(DRIVERS_COLLECTION).doc(driverId).get();
  if (!doc.exists) return null;
  return toDriverProfile(doc.data()!);
}

/** Lightweight driver info for the preferred-driver picker. */
export interface EligibleDriverOption {
  uid: string;
  displayName: string;
}

/**
 * Returns all eligible drivers for the preferred-driver selection UI.
 *
 * Only drivers with eligibilityStatus === "eligible" are included.
 * Online/offline status does NOT filter results — a resident may prefer
 * a driver who is currently offline.
 */
export async function getEligibleDriverOptions(): Promise<EligibleDriverOption[]> {
  const db = getAdminDb();

  const driversSnapshot = await db
    .collection(DRIVERS_COLLECTION)
    .where("eligibilityStatus", "==", "eligible")
    .get();

  if (driversSnapshot.empty) return [];

  // Fetch display names from users collection.
  const driverUids = driversSnapshot.docs.map((doc) => doc.id);

  // Firestore "in" queries support max 30 items; batch if needed.
  const options: EligibleDriverOption[] = [];
  const batchSize = 30;

  for (let i = 0; i < driverUids.length; i += batchSize) {
    const batch = driverUids.slice(i, i + batchSize);
    const usersSnapshot = await db
      .collection(USERS_COLLECTION)
      .where("__name__", "in", batch)
      .get();

    for (const userDoc of usersSnapshot.docs) {
      options.push({
        uid: userDoc.id,
        displayName: userDoc.data().displayName ?? "Driver",
      });
    }
  }

  // Sort alphabetically by display name for a stable UI.
  options.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return options;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface SetDriverAvailabilityInput {
  driverId: string;
  availabilityStatus: DriverAvailabilityStatus;
}

/**
 * Ensures a driver document exists. New drivers are created as ineligible
 * and offline — government staff must explicitly grant eligibility before
 * the driver can go online or claim requests.
 */
export async function ensureDriverProfile(driverId: string): Promise<DriverProfile> {
  const db = getAdminDb();
  const ref = db.collection(DRIVERS_COLLECTION).doc(driverId);
  const doc = await ref.get();

  if (doc.exists) {
    return toDriverProfile(doc.data()!);
  }

  const now = FieldValue.serverTimestamp();
  await ref.set({
    userId: driverId,
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: "Pending government approval",
    restrictedAt: null,
    restrictedBy: null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await ref.get();
  return toDriverProfile(created.data()!);
}

/**
 * Sets a driver's availability status (online/offline).
 *
 * The driver document must already exist and the driver must be eligible.
 * Going online while ineligible is rejected with DRIVER_INELIGIBLE.
 */
export async function setDriverAvailability(
  input: SetDriverAvailabilityInput,
): Promise<DriverProfile> {
  const { driverId, availabilityStatus } = input;
  const db = getAdminDb();
  const ref = db.collection(DRIVERS_COLLECTION).doc(driverId);
  const now = FieldValue.serverTimestamp();

  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("DRIVER_NOT_FOUND");
  }

  const data = doc.data()!;

  // Ineligible drivers cannot go online.
  if (availabilityStatus === "online" && data.eligibilityStatus !== "eligible") {
    throw new Error("DRIVER_INELIGIBLE");
  }

  await ref.update({
    availabilityStatus,
    updatedAt: now,
  });

  // Record audit event.
  const eventType = availabilityStatus === "online" ? "driver_online" : "driver_offline";
  await ref.collection("events").add({
    type: eventType,
    actorId: driverId,
    actorRole: "driver",
    createdAt: now,
    metadata: null,
  });

  const updated = await ref.get();
  return toDriverProfile(updated.data()!);
}

// ---------------------------------------------------------------------------
// Access restriction
// ---------------------------------------------------------------------------

export interface RestrictDriverAccessInput {
  driverId: string;
  restrictedBy: string;
  reason: string;
}

/**
 * Restricts a driver's delivery access. Sets eligibility to "ineligible"
 * and forces availability to "offline". Does NOT cancel or reassign
 * existing claimed deliveries.
 */
export async function restrictDriverAccess(
  input: RestrictDriverAccessInput,
): Promise<DriverProfile> {
  const { driverId, restrictedBy, reason } = input;
  const db = getAdminDb();
  const ref = db.collection(DRIVERS_COLLECTION).doc(driverId);
  const now = FieldValue.serverTimestamp();

  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");

  await ref.update({
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: reason,
    restrictedAt: now,
    restrictedBy,
    updatedAt: now,
  });

  await ref.collection("events").add({
    type: "driver_access_restricted",
    actorId: restrictedBy,
    actorRole: "dispatcher",
    createdAt: now,
    metadata: { reason },
  });

  const updated = await ref.get();
  return toDriverProfile(updated.data()!);
}

export interface RestoreDriverAccessInput {
  driverId: string;
  restoredBy: string;
}

/**
 * Restores a driver's delivery access. Sets eligibility to "eligible"
 * and clears restriction metadata. Does not automatically set them online.
 */
export async function restoreDriverAccess(
  input: RestoreDriverAccessInput,
): Promise<DriverProfile> {
  const { driverId, restoredBy } = input;
  const db = getAdminDb();
  const ref = db.collection(DRIVERS_COLLECTION).doc(driverId);
  const now = FieldValue.serverTimestamp();

  const doc = await ref.get();
  if (!doc.exists) throw new Error("DRIVER_NOT_FOUND");

  await ref.update({
    eligibilityStatus: "eligible",
    ineligibilityReason: null,
    restrictedAt: null,
    restrictedBy: null,
    updatedAt: now,
  });

  await ref.collection("events").add({
    type: "driver_access_restored",
    actorId: restoredBy,
    actorRole: "dispatcher",
    createdAt: now,
    metadata: null,
  });

  const updated = await ref.get();
  return toDriverProfile(updated.data()!);
}

// ---------------------------------------------------------------------------
// Query: all drivers for dispatcher management
// ---------------------------------------------------------------------------

export interface DriverListItem {
  uid: string;
  displayName: string;
  eligibilityStatus: DriverProfile["eligibilityStatus"];
  availabilityStatus: DriverProfile["availabilityStatus"];
  ineligibilityReason: string | null;
  restrictedAt: string | null;
}

/**
 * Returns all registered drivers with their profile info for the
 * dispatcher management view.
 */
export async function getAllDrivers(): Promise<DriverListItem[]> {
  const db = getAdminDb();
  const driversSnapshot = await db.collection(DRIVERS_COLLECTION).get();

  if (driversSnapshot.empty) return [];

  const driverUids = driversSnapshot.docs.map((doc) => doc.id);

  // Fetch display names from users collection.
  const displayNames: Record<string, string> = {};
  const batchSize = 30;
  for (let i = 0; i < driverUids.length; i += batchSize) {
    const batch = driverUids.slice(i, i + batchSize);
    const usersSnapshot = await db
      .collection(USERS_COLLECTION)
      .where("__name__", "in", batch)
      .get();
    for (const userDoc of usersSnapshot.docs) {
      displayNames[userDoc.id] = userDoc.data().displayName ?? "Driver";
    }
  }

  return driversSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      displayName: displayNames[doc.id] ?? "Driver",
      eligibilityStatus: data.eligibilityStatus ?? "ineligible",
      availabilityStatus: data.availabilityStatus ?? "offline",
      ineligibilityReason: data.ineligibilityReason ?? null,
      restrictedAt: data.restrictedAt?.toDate?.().toISOString() ?? null,
    };
  });
}
