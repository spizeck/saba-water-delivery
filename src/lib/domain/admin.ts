import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { isUserRole } from "@/lib/auth/roles";

import type { UserProfile, UserRole } from "./types";

/**
 * Admin domain functions for user and role management.
 *
 * All mutations here are trusted server-side operations using the
 * Firebase Admin SDK. They bypass Firestore Security Rules by design.
 * Authorization is enforced at the action/route layer (requireRole("admin")).
 */

const USERS_COLLECTION = "users";
const DRIVERS_COLLECTION = "drivers";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AdminUserListItem {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  roles: UserRole[];
  /** Only populated for users with the driver role. */
  driverStatus: {
    eligibilityStatus: "eligible" | "ineligible";
    availabilityStatus: "online" | "offline";
  } | null;
  createdAt: string;
}

/**
 * Returns all users for the admin management interface.
 * For the expected small user population, returns all users.
 */
export async function getAllUsers(): Promise<AdminUserListItem[]> {
  const db = getAdminDb();
  const usersSnapshot = await db.collection(USERS_COLLECTION).get();

  if (usersSnapshot.empty) return [];

  // Collect driver UIDs and fetch their profiles.
  const driverUids: string[] = [];
  const users: AdminUserListItem[] = [];

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    let roles: UserRole[];
    if (Array.isArray(data.roles) && data.roles.length > 0) {
      roles = data.roles.filter((r: unknown) => isUserRole(r));
    } else if (isUserRole(data.role)) {
      roles = [data.role];
    } else {
      roles = ["resident"];
    }

    if (roles.includes("driver")) {
      driverUids.push(doc.id);
    }

    users.push({
      uid: doc.id,
      displayName: data.displayName ?? "",
      email: data.email ?? null,
      phone: data.phone ?? null,
      roles,
      driverStatus: null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    });
  }

  // Fetch driver profiles in batches.
  if (driverUids.length > 0) {
    const batchSize = 30;
    for (let i = 0; i < driverUids.length; i += batchSize) {
      const batch = driverUids.slice(i, i + batchSize);
      const driverSnapshots = await Promise.all(
        batch.map((uid) => db.collection(DRIVERS_COLLECTION).doc(uid).get()),
      );
      for (const driverDoc of driverSnapshots) {
        if (!driverDoc.exists) continue;
        const driverData = driverDoc.data()!;
        const user = users.find((u) => u.uid === driverDoc.id);
        if (user) {
          user.driverStatus = {
            eligibilityStatus: driverData.eligibilityStatus ?? "ineligible",
            availabilityStatus: driverData.availabilityStatus ?? "offline",
          };
        }
      }
    }
  }

  // Sort alphabetically by display name.
  users.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return users;
}

/**
 * Returns the count of users who have the admin role.
 * Used for lockout protection.
 */
export async function countAdmins(): Promise<number> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(USERS_COLLECTION)
    .where("roles", "array-contains", "admin")
    .get();
  return snapshot.size;
}

/**
 * Returns the count of active (claimed) deliveries assigned to a driver.
 * Used to warn admins before removing the driver role.
 */
export async function getActiveDeliveryCount(driverId: string): Promise<number> {
  const db = getAdminDb();
  const snapshot = await db
    .collection("waterRequests")
    .where("assignedDriverId", "==", driverId)
    .where("status", "==", "claimed")
    .get();
  return snapshot.size;
}

// ---------------------------------------------------------------------------
// Role mutations
// ---------------------------------------------------------------------------

export interface AddRoleInput {
  targetUid: string;
  role: UserRole;
  actorId: string;
}

/**
 * Adds a role to a user. Preserves existing roles.
 * If adding "driver", ensures the driver profile document exists.
 * Also cleans up legacy singular `role` field when writing.
 */
export async function addRole(input: AddRoleInput): Promise<UserProfile> {
  const { targetUid, role, actorId } = input;
  const db = getAdminDb();
  const userRef = db.collection(USERS_COLLECTION).doc(targetUid);
  const now = FieldValue.serverTimestamp();

  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

  const data = userDoc.data()!;
  let currentRoles: UserRole[];
  if (Array.isArray(data.roles) && data.roles.length > 0) {
    currentRoles = data.roles.filter((r: unknown) => isUserRole(r));
  } else if (isUserRole(data.role)) {
    currentRoles = [data.role];
  } else {
    currentRoles = ["resident"];
  }

  if (currentRoles.includes(role)) {
    throw new Error("ROLE_ALREADY_EXISTS");
  }

  const newRoles = [...currentRoles, role];

  // Write canonical roles array, remove legacy role field.
  await userRef.update({
    roles: newRoles,
    role: FieldValue.delete(),
    updatedAt: now,
  });

  // Record audit event.
  await userRef.collection("roleEvents").add({
    type: "role_added",
    role,
    actorId,
    createdAt: now,
  });

  // If adding driver role, ensure driver profile exists.
  if (role === "driver") {
    const driverRef = db.collection(DRIVERS_COLLECTION).doc(targetUid);
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) {
      await driverRef.set({
        userId: targetUid,
        eligibilityStatus: "ineligible",
        availabilityStatus: "offline",
        ineligibilityReason: "Pending government approval",
        restrictedAt: null,
        restrictedBy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const updated = await userRef.get();
  return toUserProfileFromDoc(targetUid, updated.data()!);
}

export interface RemoveRoleInput {
  targetUid: string;
  role: UserRole;
  actorId: string;
}

/**
 * Removes a role from a user.
 * 
 * Guards:
 * - Cannot remove "resident" (baseline role).
 * - Cannot remove own final "admin" role (self-lockout).
 * - Cannot remove the system's last "admin" role.
 * 
 * If removing "driver", forces availability to offline but preserves
 * the driver profile and delivery history.
 */
export async function removeRole(input: RemoveRoleInput): Promise<UserProfile> {
  const { targetUid, role, actorId } = input;
  const db = getAdminDb();
  const userRef = db.collection(USERS_COLLECTION).doc(targetUid);
  const now = FieldValue.serverTimestamp();

  if (role === "resident") {
    throw new Error("CANNOT_REMOVE_RESIDENT");
  }

  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

  const data = userDoc.data()!;
  let currentRoles: UserRole[];
  if (Array.isArray(data.roles) && data.roles.length > 0) {
    currentRoles = data.roles.filter((r: unknown) => isUserRole(r));
  } else if (isUserRole(data.role)) {
    currentRoles = [data.role];
  } else {
    currentRoles = ["resident"];
  }

  if (!currentRoles.includes(role)) {
    throw new Error("ROLE_NOT_FOUND");
  }

  // Admin lockout protections.
  if (role === "admin") {
    // Self-lockout: admin removing their own admin role.
    if (targetUid === actorId) {
      throw new Error("CANNOT_REMOVE_OWN_ADMIN");
    }
    // System lockout: check if this is the last admin.
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      throw new Error("LAST_ADMIN");
    }
  }

  const newRoles = currentRoles.filter((r) => r !== role);

  // Write canonical roles array, remove legacy role field.
  await userRef.update({
    roles: newRoles,
    role: FieldValue.delete(),
    updatedAt: now,
  });

  // Record audit event.
  await userRef.collection("roleEvents").add({
    type: "role_removed",
    role,
    actorId,
    createdAt: now,
  });

  // If removing driver role, force offline but preserve profile.
  if (role === "driver") {
    const driverRef = db.collection(DRIVERS_COLLECTION).doc(targetUid);
    const driverDoc = await driverRef.get();
    if (driverDoc.exists) {
      await driverRef.update({
        availabilityStatus: "offline",
        updatedAt: now,
      });
      // Record driver event.
      await driverRef.collection("events").add({
        type: "driver_offline",
        actorId,
        actorRole: "admin",
        createdAt: now,
        metadata: { reason: "Driver role removed" },
      });
    }
  }

  const updated = await userRef.get();
  return toUserProfileFromDoc(targetUid, updated.data()!);
}

// ---------------------------------------------------------------------------
// User role event history
// ---------------------------------------------------------------------------

export interface RoleEvent {
  id: string;
  type: "role_added" | "role_removed";
  role: UserRole;
  actorId: string;
  createdAt: string;
}

export async function getRoleEvents(uid: string): Promise<RoleEvent[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection("roleEvents")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type,
      role: data.role,
      actorId: data.actorId,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Driver event history (for admin user detail)
// ---------------------------------------------------------------------------

export interface DriverEventItem {
  id: string;
  type: string;
  actorId: string | null;
  actorRole: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export async function getDriverEvents(driverId: string): Promise<DriverEventItem[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(DRIVERS_COLLECTION)
    .doc(driverId)
    .collection("events")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type ?? "",
      actorId: data.actorId ?? null,
      actorRole: data.actorRole ?? null,
      createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
      metadata: data.metadata ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toUserProfileFromDoc(uid: string, data: Record<string, unknown>): UserProfile {
  let roles: UserRole[];
  if (Array.isArray(data.roles) && (data.roles as unknown[]).length > 0) {
    roles = (data.roles as unknown[]).filter((r): r is UserRole => isUserRole(r));
  } else if (isUserRole(data.role)) {
    roles = [data.role as UserRole];
  } else {
    roles = ["resident"];
  }

  return {
    uid,
    displayName: (data.displayName as string) ?? "",
    email: (data.email as string) ?? null,
    phone: (data.phone as string) ?? null,
    roles,
    village: (data.village as string) ?? null,
    deliveryDirections: (data.deliveryDirections as string) ?? null,
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.().toISOString() ??
      new Date(0).toISOString(),
    updatedAt:
      (data.updatedAt as { toDate?: () => Date })?.toDate?.().toISOString() ??
      new Date(0).toISOString(),
  };
}
