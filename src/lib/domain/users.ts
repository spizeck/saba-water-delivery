import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import type { UserProfile, UserRole } from "./types";
import { toUserRoles } from "@/lib/auth/roles";
import { isValidSabaVillage } from "./villages";

const USERS_COLLECTION = "users";

/**
 * Normalizes a Firestore user document into a UserProfile.
 *
 * `roles` is the canonical role array. Documents without a valid `roles`
 * field are treated as residents.
 */
function toUserProfile(uid: string, data: DocumentData): UserProfile {
  const roles = toUserRoles(data.roles);

  return {
    uid,
    displayName: data.displayName ?? "",
    email: data.email ?? null,
    phone: data.phone ?? null,
    roles,
    village: data.village ?? null,
    deliveryDirections: data.deliveryDirections ?? null,
    // Missing on historical documents that predate this field — treated
    // as "never confirmed" (null), never backfilled (see PRODUCT.md
    // "Delivery Profile Confirmation Reminder").
    deliveryProfileConfirmedAt: data.deliveryProfileConfirmedAt?.toDate?.().toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  };
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getAdminDb().collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return null;
  return toUserProfile(uid, snapshot.data()!);
}

// ---------------------------------------------------------------------------
// Staff-facing resident directory (dispatcher "Create Water Request")
// ---------------------------------------------------------------------------

export interface ResidentDirectoryEntry {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  village: string | null;
  deliveryDirections: string | null;
}

/**
 * Returns a lightweight directory of registered residents for dispatcher
 * staff to search by name/phone/email when creating a water request on
 * behalf of someone who called or visited the office. Deliberately
 * excludes role/driver-management fields present in the admin user list
 * (`src/lib/domain/admin.ts`) — this is scoped to what dispatchers need
 * to identify a customer and pre-fill their delivery info, not full
 * account administration.
 *
 * At island scale, returning the full list and filtering client-side
 * (matching the existing admin `UserList` pattern) is simpler than
 * building a search index.
 */
export async function getResidentDirectory(): Promise<ResidentDirectoryEntry[]> {
  const db = getAdminDb();
  const snapshot = await db.collection(USERS_COLLECTION).get();

  const results: ResidentDirectoryEntry[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const roles = toUserRoles(data.roles);
    if (!roles.includes("resident")) continue;

    results.push({
      uid: doc.id,
      displayName: data.displayName ?? "",
      email: data.email ?? null,
      phone: data.phone ?? null,
      village: data.village ?? null,
      deliveryDirections: data.deliveryDirections ?? null,
    });
  }

  results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return results;
}

export interface EnsureUserProfileInput {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface EnsureUserProfileResult {
  profile: UserProfile;
  /** True when this call was the one that created the profile. */
  created: boolean;
}

/**
 * Ensures a Firestore profile exists for a newly authenticated user.
 *
 * New users always default to roles: ["resident"] — this is the only
 * place roles are ever assigned to a brand-new account, and it is not
 * influenced by anything the client submits. If a profile already
 * exists, it is returned unchanged: re-authenticating must never reset
 * an existing user's roles or overwrite their saved profile information.
 *
 * Uses `create` (not `set`) and a retry read so concurrent first-time
 * logins cannot overwrite an existing profile and `created` is accurate
 * for each caller.
 */
export async function ensureUserProfile(
  input: EnsureUserProfileInput,
): Promise<EnsureUserProfileResult> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);

  const existing = await ref.get();
  if (existing.exists) {
    return { profile: toUserProfile(input.uid, existing.data()!), created: false };
  }

  const defaultRoles: UserRole[] = ["resident"];
  const now = FieldValue.serverTimestamp();
  const newData = {
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    roles: defaultRoles,
    village: null,
    deliveryDirections: null,
    deliveryProfileConfirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ref.create(newData);
  } catch (err: unknown) {
    // Another concurrent call likely created the document. Re-read and
    // return the existing profile as long as it now exists.
    const after = await ref.get();
    if (!after.exists) {
      throw err;
    }
    return { profile: toUserProfile(input.uid, after.data()!), created: false };
  }

  const after = await ref.get();
  return { profile: toUserProfile(input.uid, after.data()!), created: true };
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
 *
 * If the resident actually changes any delivery-relevant field (phone,
 * village, delivery directions), `deliveryProfileConfirmedAt` is
 * refreshed to now — saving a change to this information IS an active
 * review of it, so the resident should not also have to return to the
 * delivery-profile reminder and click "Everything Is Correct" right
 * after editing (see PRODUCT.md "Delivery Profile Confirmation
 * Reminder"). Editing only unrelated fields (e.g. display name) does
 * not refresh it.
 */
export async function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
  if (input.village !== null && !isValidSabaVillage(input.village)) {
    throw new Error("INVALID_VILLAGE");
  }

  const ref = getAdminDb().collection(USERS_COLLECTION).doc(input.uid);

  const existingSnapshot = await ref.get();
  const existing = existingSnapshot.exists ? existingSnapshot.data()! : null;
  const deliveryFieldsChanged =
    !existing ||
    (existing.phone ?? null) !== input.phone ||
    (existing.village ?? null) !== input.village ||
    (existing.deliveryDirections ?? null) !== input.deliveryDirections;

  const now = FieldValue.serverTimestamp();
  const updateData: Record<string, unknown> = {
    displayName: input.displayName,
    phone: input.phone,
    village: input.village,
    deliveryDirections: input.deliveryDirections,
    updatedAt: now,
  };
  if (deliveryFieldsChanged) {
    updateData.deliveryProfileConfirmedAt = now;
  }

  await ref.update(updateData);
  const updated = await ref.get();
  return toUserProfile(input.uid, updated.data()!);
}

/**
 * Records that the resident affirmatively reviewed their delivery
 * information (phone/village/deliveryDirections) and confirmed it is
 * still correct — the server action behind "Everything Is Correct" on
 * the delivery-profile reminder. Never trusts a client-provided
 * timestamp; always writes the server's own clock.
 *
 * Refuses to confirm an incomplete profile server-side
 * (`DELIVERY_PROFILE_INCOMPLETE`) — this mirrors the UI, which never
 * offers "Everything Is Correct" when required fields are missing, but
 * must not be the only place that rule is enforced (see DEVIN.md
 * "Never rely on UI visibility for access control").
 */
export async function confirmDeliveryProfile(uid: string): Promise<UserProfile> {
  const ref = getAdminDb().collection(USERS_COLLECTION).doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("USER_NOT_FOUND");
  }

  const data = snapshot.data()!;
  const hasRequiredFields =
    Boolean((data.phone ?? "").toString().trim()) &&
    Boolean((data.village ?? "").toString().trim()) &&
    Boolean((data.deliveryDirections ?? "").toString().trim());

  if (!hasRequiredFields) {
    throw new Error("DELIVERY_PROFILE_INCOMPLETE");
  }

  await ref.update({ deliveryProfileConfirmedAt: FieldValue.serverTimestamp() });
  const updated = await ref.get();
  return toUserProfile(uid, updated.data()!);
}
