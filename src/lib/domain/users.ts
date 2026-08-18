import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import type { UserProfile, UserRole } from "./types";
import { isUserRole } from "@/lib/auth/roles";

const USERS_COLLECTION = "users";

/**
 * Normalizes a Firestore user document into a UserProfile.
 *
 * Handles backward compatibility: existing documents may have a singular
 * `role` field instead of the canonical `roles` array. This function
 * reads both and produces a valid `roles` array regardless of which
 * field(s) are present in the stored document.
 */
function toUserProfile(uid: string, data: DocumentData): UserProfile {
  let roles: UserRole[];

  if (Array.isArray(data.roles) && data.roles.length > 0) {
    // New canonical format
    roles = data.roles.filter((r: unknown) => isUserRole(r));
  } else if (isUserRole(data.role)) {
    // Legacy singular-role format — treat as single-element array
    roles = [data.role];
  } else {
    // Fallback: no valid role info, default to resident
    roles = ["resident"];
  }

  return {
    uid,
    displayName: data.displayName ?? "",
    email: data.email ?? null,
    phone: data.phone ?? null,
    roles,
    village: data.village ?? null,
    deliveryDirections: data.deliveryDirections ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  };
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getAdminDb().collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return null;
  return toUserProfile(uid, snapshot.data()!);
}

export interface EnsureUserProfileInput {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

/**
 * Ensures a Firestore profile exists for a newly authenticated user.
 *
 * New users always default to roles: ["resident"] — this is the only
 * place roles are ever assigned to a brand-new account, and it is not
 * influenced by anything the client submits. If a profile already
 * exists, it is returned unchanged: re-authenticating must never reset
 * an existing user's roles or overwrite their saved profile information.
 */
export async function ensureUserProfile(input: EnsureUserProfileInput): Promise<UserProfile> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);
  const existing = await ref.get();
  if (existing.exists) {
    return toUserProfile(input.uid, existing.data()!);
  }

  const defaultRoles: UserRole[] = ["resident"];
  const now = FieldValue.serverTimestamp();
  await ref.set({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    roles: defaultRoles,
    village: null,
    deliveryDirections: null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await ref.get();
  return toUserProfile(input.uid, created.data()!);
}

export interface UpdateUserProfileInput {
  uid: string;
  displayName: string;
  phone: string | null;
  village: string | null;
  deliveryDirections: string | null;
}

/**
 * Updates resident-facing profile fields. Deliberately does not accept or
 * touch `role` — role changes are a separate, staff-only operation.
 */
export async function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);
  await ref.update({
    displayName: input.displayName,
    phone: input.phone,
    village: input.village,
    deliveryDirections: input.deliveryDirections,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const updated = await ref.get();
  return toUserProfile(input.uid, updated.data()!);
}
