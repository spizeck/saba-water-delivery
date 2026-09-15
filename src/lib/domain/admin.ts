import "server-only";

import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

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

/**
 * Server-only singleton collection/document used to serialize admin-reducing
 * mutations so the "never remove the last admin" invariant holds under
 * concurrency. Introduced for `removeRole` (issue #48) and extended to every
 * supported admin-reducing mutation — `mergeUserAccounts` included (issue #70).
 * Denied to all clients in `firestore.rules`; only trusted Admin SDK code
 * touches it.
 */
export const SYSTEM_INVARIANTS_COLLECTION = "systemInvariants";
export const ADMIN_ROLE_INVARIANT_DOC = "adminRole";

// ---------------------------------------------------------------------------
// Shared last-admin invariant protocol (issues #48, #70)
// ---------------------------------------------------------------------------
//
// Every supported server-side mutation that can reduce the admin population
// (today: `removeRole` and an admin-demoting `mergeUserAccounts`) runs through
// this ONE protocol so they serialize against EACH OTHER, not just within their
// own type. The protocol has two phases that bracket a transaction's own reads
// and writes, because Firestore requires all reads before all writes:
//
//   1. readAdminPopulationInTransaction() — reads the shared invariant document
//      AND the live admin set. The live `users` data is the source of truth for
//      the count; the invariant document's stored `adminCount` is observability
//      metadata only.
//   2. recordAdminInvariantParticipation() — writes the invariant document, so
//      the calling transaction both READ and WROTE that single document. Two
//      concurrent admin-reducing transactions therefore contend on it and are
//      serialized by Firestore; the loser is retried and re-evaluates against
//      the now-smaller admin set, failing closed with LAST_ADMIN.
//
// Callers MUST invoke phase 1 before issuing any write, decide using the
// returned live admin uids, and invoke phase 2 as part of their writes.

/** Reference to the shared admin-role invariant singleton document. */
export function adminRoleInvariantRef(db: Firestore): DocumentReference {
  return db
    .collection(SYSTEM_INVARIANTS_COLLECTION)
    .doc(ADMIN_ROLE_INVARIANT_DOC);
}

export interface AdminPopulationRead {
  invariantSnap: DocumentSnapshot;
  /** uids of every user that currently holds the admin role (source of truth). */
  adminUids: string[];
}

/**
 * Phase 1 of the shared invariant protocol — see the block comment above. Reads
 * the invariant singleton and the live admin set inside `txn`. Call this BEFORE
 * the transaction issues any write.
 */
export async function readAdminPopulationInTransaction(
  db: Firestore,
  txn: Transaction,
): Promise<AdminPopulationRead> {
  const invariantSnap = await txn.get(adminRoleInvariantRef(db));
  const adminSnap = await txn.get(
    db.collection(USERS_COLLECTION).where("roles", "array-contains", "admin"),
  );
  return { invariantSnap, adminUids: adminSnap.docs.map((doc) => doc.id) };
}

/**
 * Phase 2 of the shared invariant protocol — see the block comment above.
 * Writes the invariant singleton so the calling transaction both read and wrote
 * it (the deliberate contention point). `adminCountAfter` is the live admin
 * count AFTER this mutation applies; it is recomputed from the live query every
 * time (self-healing observability metadata) and is never the source of truth.
 */
export function recordAdminInvariantParticipation(
  db: Firestore,
  txn: Transaction,
  invariantSnap: DocumentSnapshot,
  adminCountAfter: number,
  actorId: string,
): void {
  const priorRevision =
    typeof invariantSnap.data()?.revision === "number"
      ? (invariantSnap.data()!.revision as number)
      : 0;
  txn.set(
    adminRoleInvariantRef(db),
    {
      revision: priorRevision + 1,
      adminCount: adminCountAfter,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    },
    { merge: true },
  );
}

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
  /** Whether the person has portal login access. */
  authStatus: "claimed" | "unclaimed";
  /**
   * When set, this account was merged away into the listed canonical uid —
   * the identity is rejected by authentication and must not be offered as a
   * merge candidate. Null for normal accounts.
   */
  mergedIntoUserId: string | null;
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
      authStatus: data.authStatus === "unclaimed" ? "unclaimed" : "claimed",
      mergedIntoUserId:
        typeof data.mergedIntoUserId === "string"
          ? data.mergedIntoUserId
          : null,
      createdAt:
        data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    });
  }

  // Fetch linked Driver Registry entries in batches (eligibility and
  // availability live on the registry — see TECHNICAL.md "Driver
  // Registry"). A user with the `driver` role but no linked registry
  // entry simply shows no driver status.
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
 * - Cannot remove the system's last "admin" role — enforced transactionally
 *   and serialized against concurrent admin removals via a shared singleton
 *   invariant document (see {@link SYSTEM_INVARIANTS_COLLECTION} and issue #48),
 *   so two simultaneous removals of different admins can never both succeed.
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

  // Self-lockout is deterministic (the actor cannot change their own uid
  // mid-operation), so it is safe and cheapest to reject before the
  // transaction. The last-admin guard, by contrast, MUST run inside the
  // transaction — see below.
  if (role === "admin" && targetUid === actorId) {
    throw new Error("CANNOT_REMOVE_OWN_ADMIN");
  }

  // The last-admin guard MUST be enforced inside the transaction. The previous
  // implementation counted admins BEFORE the transaction, which re-read only
  // the target user; two concurrent removals of DIFFERENT admins both observed
  // two admins and both committed, because their transactions touched only
  // their own disjoint user documents and so never conflicted, leaving the
  // system with zero admins (issue #48).
  //
  // Fix: every admin removal participates in the shared last-admin invariant
  // protocol (read the invariant document + the live admin set, then write the
  // invariant document in the same transaction). That single shared document is
  // the point of contention that serializes this removal against every other
  // admin-reducing mutation — concurrent removals AND admin-demoting account
  // merges (issue #70) — so the loser is retried and, re-reading the
  // now-smaller admin set, is correctly rejected. The admin count comes from
  // the live users query (never a denormalized counter), so it cannot drift.
  await db.runTransaction(async (txn) => {
    const now = FieldValue.serverTimestamp();
    const isAdminRemoval = role === "admin";

    // All reads must precede all writes in a Firestore transaction.
    const population = isAdminRemoval
      ? await readAdminPopulationInTransaction(db, txn)
      : null;

    // Re-read the user document inside the transaction so the write is based
    // on the latest committed state.
    const freshUserDoc = await txn.get(userRef);
    if (!freshUserDoc.exists) throw new Error("USER_NOT_FOUND");
    const freshData = freshUserDoc.data()!;
    const freshRoles = toUserRoles(freshData.roles);
    if (!freshRoles.includes(role)) {
      throw new Error("ROLE_NOT_FOUND");
    }

    // The target still holds admin (validated just above) and so is one of the
    // live admins; removing it drops the count by exactly one.
    const adminsAfter = isAdminRemoval
      ? population!.adminUids.filter((uid) => uid !== targetUid)
      : [];
    if (isAdminRemoval && adminsAfter.length < 1) {
      throw new Error("LAST_ADMIN");
    }

    const newRoles = freshRoles.filter((r) => r !== role);

    txn.update(userRef, {
      roles: newRoles,
      updatedAt: now,
    });

    if (isAdminRemoval) {
      recordAdminInvariantParticipation(
        db,
        txn,
        population!.invariantSnap,
        adminsAfter.length,
        actorId,
      );
    }

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
      createdAt:
        data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toUserProfileFromDoc(
  uid: string,
  data: Record<string, unknown>,
): UserProfile {
  const roles = toUserRoles(data.roles);

  return {
    uid,
    displayName: (data.displayName as string) ?? "",
    email: (data.email as string) ?? null,
    phone: (data.phone as string) ?? null,
    roles,
    village: (data.village as string) ?? null,
    deliveryDirections: (data.deliveryDirections as string) ?? null,
    deliveryProfileConfirmedAt:
      (data.deliveryProfileConfirmedAt as { toDate?: () => Date })
        ?.toDate?.()
        .toISOString() ?? null,
    accountOrigin:
      data.accountOrigin === "staff_registered"
        ? "staff_registered"
        : "self_registered",
    authStatus: data.authStatus === "unclaimed" ? "unclaimed" : "claimed",
    mergedIntoUserId:
      typeof data.mergedIntoUserId === "string"
        ? (data.mergedIntoUserId as string)
        : null,
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.().toISOString() ??
      new Date(0).toISOString(),
    updatedAt:
      (data.updatedAt as { toDate?: () => Date })?.toDate?.().toISOString() ??
      new Date(0).toISOString(),
  };
}
