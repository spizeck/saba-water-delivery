import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { toUserRoles } from "@/lib/auth/roles";

import type { UserProfile, UserRole } from "./types";

/**
 * Admin domain functions for user and role management.
 *
 * All mutations here are trusted server-side operations using the
 * Firebase Admin SDK. They bypass Firestore Security Rules by design.
 * Authorization is enforced at the action/route layer (requireRole("admin")).
 */

const USERS_COLLECTION = "users";
const DRIVER_REGISTRY_COLLECTION = "driverRegistry";

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
    const roles = toUserRoles(data.roles);

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

  // Fetch linked Driver Registry entries in batches (eligibility/
  // availability now live on the registry, not a legacy `drivers/{uid}`
  // doc — see TECHNICAL.md "Driver Registry"). A user with the `driver`
  // role but no linked registry entry simply shows no driver status.
  if (driverUids.length > 0) {
    const batchSize = 30;
    for (let i = 0; i < driverUids.length; i += batchSize) {
      const batch = driverUids.slice(i, i + batchSize);
      const registrySnapshot = await db
        .collection(DRIVER_REGISTRY_COLLECTION)
        .where("linkedUserId", "in", batch)
        .get();
      for (const driverDoc of registrySnapshot.docs) {
        const driverData = driverDoc.data();
        const user = users.find((u) => u.uid === driverData.linkedUserId);
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
 *
 * The "driver" role is managed exclusively by the Driver Registry. Any
 * attempt to add it through generic role management is rejected.
 */
export async function addRole(input: AddRoleInput): Promise<UserProfile> {
  const { targetUid, role, actorId } = input;
  const db = getAdminDb();
  const userRef = db.collection(USERS_COLLECTION).doc(targetUid);

  if (role === "driver") {
    throw new Error("DRIVER_ROLE_SYSTEM_MANAGED");
  }

  await db.runTransaction(async (txn) => {
    const userDoc = await txn.get(userRef);
    if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

    const data = userDoc.data()!;
    const currentRoles = toUserRoles(data.roles);

    if (currentRoles.includes(role)) {
      throw new Error("ROLE_ALREADY_EXISTS");
    }

    const newRoles = [...currentRoles, role];
    const now = FieldValue.serverTimestamp();

    txn.update(userRef, {
      roles: newRoles,
      updatedAt: now,
    });

    const eventRef = userRef.collection("roleEvents").doc();
    txn.set(eventRef, {
      type: "role_added",
      role,
      actorId,
      createdAt: now,
    });
  });

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
 * - Cannot remove the "driver" role (managed by the Driver Registry).
 * - Cannot remove own final "admin" role (self-lockout).
 * - Cannot remove the system's last "admin" role.
 */
export async function removeRole(input: RemoveRoleInput): Promise<UserProfile> {
  const { targetUid, role, actorId } = input;
  const db = getAdminDb();
  const userRef = db.collection(USERS_COLLECTION).doc(targetUid);

  if (role === "resident") {
    throw new Error("CANNOT_REMOVE_RESIDENT");
  }
  if (role === "driver") {
    throw new Error("DRIVER_ROLE_SYSTEM_MANAGED");
  }

  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error("USER_NOT_FOUND");

  const data = userDoc.data()!;
  const currentRoles = toUserRoles(data.roles);

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

  await db.runTransaction(async (txn) => {
    const now = FieldValue.serverTimestamp();

    // Re-read the user document inside the transaction so the write is based
    // on the latest committed state. The pre-transaction guards above already
    // validated the operation; this re-read protects against races.
    const freshUserDoc = await txn.get(userRef);
    if (!freshUserDoc.exists) throw new Error("USER_NOT_FOUND");
    const freshData = freshUserDoc.data()!;
    const freshRoles = toUserRoles(freshData.roles);
    if (!freshRoles.includes(role)) {
      throw new Error("ROLE_NOT_FOUND");
    }

    const newRoles = freshRoles.filter((r) => r !== role);

    txn.update(userRef, {
      roles: newRoles,
      updatedAt: now,
    });

    const userEventRef = userRef.collection("roleEvents").doc();
    txn.set(userEventRef, {
      type: "role_removed",
      role,
      actorId,
      createdAt: now,
    });
  });

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
// Internal helpers
// ---------------------------------------------------------------------------

function toUserProfileFromDoc(uid: string, data: Record<string, unknown>): UserProfile {
  const roles = toUserRoles(data.roles);

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
