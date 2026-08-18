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
    eligibilityStatus: data.eligibilityStatus ?? "eligible",
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
 * Sets a driver's availability status (online/offline).
 *
 * Creates/ensures the driver document exists (upsert pattern) and records
 * an audit event for the availability change.
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
    // First time a driver goes online — create the driver document.
    await ref.set({
      userId: driverId,
      eligibilityStatus: "eligible",
      availabilityStatus,
      ineligibilityReason: null,
      restrictedAt: null,
      restrictedBy: null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await ref.update({
      availabilityStatus,
      updatedAt: now,
    });
  }

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
// Access restriction (stubs — not implemented this phase)
// ---------------------------------------------------------------------------

export interface RestrictDriverAccessInput {
  driverId: string;
  restrictedBy: string;
  reason: string;
}

export async function restrictDriverAccess(
  _input: RestrictDriverAccessInput,
): Promise<DriverProfile> {
  throw new Error("restrictDriverAccess is not implemented yet.");
}

export interface RestoreDriverAccessInput {
  driverId: string;
  restoredBy: string;
}

export async function restoreDriverAccess(
  _input: RestoreDriverAccessInput,
): Promise<DriverProfile> {
  throw new Error("restoreDriverAccess is not implemented yet.");
}
