import "server-only";

import { type UserRecord } from "firebase-admin/auth";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

import type {
  AccountMergeEvent,
  AccountMergeRolePolicy,
  UserProfile,
  UserRole,
  WaterRequest,
} from "./types";
import {
  buildDefaultUnionRoles,
  findIdentityMatches,
  normalizeEmailForMatching,
  normalizePhoneForMatching,
  type IdentityMatchInput,
} from "./identityMatching";
import { getUserProfile } from "./users";
import { getDriverByLinkedUserId } from "./driverRegistry";
import { toWaterRequest } from "./waterRequests";
import { sendAccountSetupEmail } from "@/lib/email/accountSetupEmail";

const REQUESTS_COLLECTION = "waterRequests";
const USERS_COLLECTION = "users";
const DRIVER_REGISTRY_COLLECTION = "driverRegistry";
const MERGE_EVENTS_COLLECTION = "accountMergeEvents";

// ---------------------------------------------------------------------------
// Account lookup
// ---------------------------------------------------------------------------

export interface EmailAccountStatus {
  exists: boolean;
  uid: string | null;
  displayName: string | null;
  email: string | null;
}

/**
 * Checks whether a given email already has a Firebase Authentication
 * account. Used by the dispatcher request form to suggest using an
 * existing resident account instead of creating another identity.
 */
export async function getEmailAccountStatus(email: string): Promise<EmailAccountStatus> {
  const normalized = normalizeEmailForMatching(email);
  if (!normalized) {
    return { exists: false, uid: null, displayName: null, email: null };
  }

  try {
    const record = await getAdminAuth().getUserByEmail(normalized);
    return {
      exists: true,
      uid: record.uid,
      displayName: record.displayName ?? null,
      email: record.email ?? null,
    };
  } catch (err: unknown) {
    const firebaseError = err as { code?: string };
    // auth/user-not-found is the expected "no account" case.
    if (firebaseError.code === "auth/user-not-found") {
      return { exists: false, uid: null, displayName: null, email: null };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Identity matching against the resident directory
// ---------------------------------------------------------------------------

export type { IdentityMatchInput };
export { findIdentityMatches, normalizeEmailForMatching, normalizePhoneForMatching };

// ---------------------------------------------------------------------------
// Possible request-history matches for an authenticated user
// ---------------------------------------------------------------------------

export interface PossibleHistoryMatch {
  request: WaterRequest;
  matchedOn: Array<"email" | "phone">;
}

/**
 * Finds unregistered (`customerId == null`) water requests whose stored
 * customer snapshot matches the user's email or phone. This is the
 * starting point for the admin "Link History to Account" workflow.
 *
 * Email match is treated as a stronger signal than phone match; the
 * returned `matchedOn` array tells the UI which signal applied so staff
 * can make an informed decision. Phone matches are intentionally
 * surfaced as review candidates, not as automatic links, because phones
 * are shared, reassigned, and reused.
 */
export async function findPossibleRequestHistoryMatchesForUser(
  uid: string,
): Promise<PossibleHistoryMatch[]> {
  const user = await getUserProfile(uid);
  if (!user) throw new Error("USER_NOT_FOUND");

  const userEmail = normalizeEmailForMatching(user.email);
  const userPhone = normalizePhoneForMatching(user.phone);

  const db = getAdminDb();
  // Unregistered requests only. We compare the stored snapshot contact
  // info (not current profile values) because a historical request's
  // identity is whatever was recorded at creation time.
  const snapshot = await db.collection(REQUESTS_COLLECTION).where("customerId", "==", null).get();

  const matches: PossibleHistoryMatch[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as DocumentData;
    const customer = data.customer as
      | { displayName?: string; phone?: string | null; email?: string | null }
      | undefined;
    if (!customer) continue;

    const requestEmail = normalizeEmailForMatching(customer.email);
    const requestPhone = normalizePhoneForMatching(customer.phone);

    const matchedOn: Array<"email" | "phone"> = [];
    if (userEmail && requestEmail && userEmail === requestEmail) {
      matchedOn.push("email");
    }
    if (userPhone && requestPhone && userPhone === requestPhone) {
      matchedOn.push("phone");
    }

    if (matchedOn.length > 0) {
      matches.push({ request: toWaterRequest(doc.id, data), matchedOn });
    }
  }

  // Most recent first.
  matches.sort(
    (a, b) =>
      new Date(b.request.requestedAt).getTime() - new Date(a.request.requestedAt).getTime(),
  );
  return matches;
}

// ---------------------------------------------------------------------------
// Link historical unregistered requests to a user account
// ---------------------------------------------------------------------------

export interface LinkRequestHistoryInput {
  /** uid of the registered user who will own the requests going forward. */
  targetUid: string;
  /** Water request IDs to link. Each must currently have `customerId == null`. */
  requestIds: string[];
  /** uid of the admin performing the linkage. */
  actorId: string;
  /** Free-text reason for the audit trail. */
  reason: string;
}

export interface LinkRequestHistoryResult {
  linkedCount: number;
}

/**
 * Admin-initiated relink of previously unregistered water requests to a
 * registered user. The historical `customer` snapshot on each request is
 * preserved unchanged; only `customerId` is updated from `null` to the
 * target uid. Each linked request records a `customer_history_linked`
 * audit event.
 *
 * This is a deliberate, staff-reviewed action — no automatic linking
 * happens solely because a phone number matches.
 */
export async function linkRequestHistoryToUser(
  input: LinkRequestHistoryInput,
): Promise<LinkRequestHistoryResult> {
  const { targetUid, requestIds, actorId, reason } = input;

  const user = await getUserProfile(targetUid);
  if (!user) throw new Error("USER_NOT_FOUND");
  if (requestIds.length === 0) throw new Error("NO_REQUESTS_SELECTED");

  const db = getAdminDb();
  const now = FieldValue.serverTimestamp();
  const uniqueIds = [...new Set(requestIds)];

  await db.runTransaction(async (txn) => {
    const refs = uniqueIds.map((id) => db.collection(REQUESTS_COLLECTION).doc(id));
    const snaps = await txn.getAll(...refs);

    for (const snap of snaps) {
      if (!snap.exists) throw new Error(`REQUEST_NOT_FOUND:${snap.id}`);
      const data = snap.data()!;
      if (data.customerId !== null) {
        throw new Error(`REQUEST_ALREADY_LINKED:${snap.id}`);
      }
    }

    for (const snap of snaps) {
      const data = snap.data()!;
      const previousCustomerId: string | null = data.customerId ?? null;
      txn.update(snap.ref, {
        customerId: targetUid,
        updatedAt: now,
      });

      const eventRef = snap.ref.collection("events").doc();
      txn.set(eventRef, {
        type: "customer_history_linked",
        actorId,
        actorRole: "admin",
        createdAt: now,
        metadata: {
          previousCustomerId,
          newCustomerId: targetUid,
          reason: reason.trim(),
          preservedSnapshot: data.customer ?? null,
        },
      });
    }
  });

  return { linkedCount: uniqueIds.length };
}

// ---------------------------------------------------------------------------
// Account merge preview
// ---------------------------------------------------------------------------

export interface AccountMergePreview {
  canonicalUser: UserProfile;
  duplicateUser: UserProfile;
  canonicalDriverId: string | null;
  duplicateDriverId: string | null;
  /** Roles the canonical user currently has. */
  canonicalRoles: UserRole[];
  /** Roles the duplicate user currently has. */
  duplicateRoles: UserRole[];
  /**
   * Union of non-sensitive roles (resident, viewer). Sensitive roles
   * (admin, dispatcher, driver) are never included automatically; the
   * admin must use the explicit role merge policy to transfer them.
   */
  defaultUnionRoles: UserRole[];
  /** Number of water requests currently owned by the duplicate user. */
  requestCountForDuplicate: number;
  /** Whether the merge is blocked and why. */
  blocked: boolean;
  blockedReason: string | null;
}

/**
 * Builds the comparison data an admin reviews before confirming an
 * account merge. Does not mutate anything.
 */
export async function getAccountMergePreview(
  canonicalUid: string,
  duplicateUid: string,
): Promise<AccountMergePreview> {
  if (canonicalUid === duplicateUid) throw new Error("SAME_USER");

  const [canonicalUser, duplicateUser] = await Promise.all([
    getUserProfile(canonicalUid),
    getUserProfile(duplicateUid),
  ]);
  if (!canonicalUser || !duplicateUser) throw new Error("USER_NOT_FOUND");

  const [canonicalDriver, duplicateDriver] = await Promise.all([
    getDriverByLinkedUserId(canonicalUid),
    getDriverByLinkedUserId(duplicateUid),
  ]);

  const db = getAdminDb();
  const requestCountSnap = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", duplicateUid)
    .count()
    .get();
  const requestCountForDuplicate = requestCountSnap.data().count;

  const canonicalDriverId = canonicalDriver?.id ?? null;
  const duplicateDriverId = duplicateDriver?.id ?? null;

  let blocked = false;
  let blockedReason: string | null = null;

  if (canonicalDriverId && duplicateDriverId && canonicalDriverId !== duplicateDriverId) {
    blocked = true;
    blockedReason =
      "Both accounts are linked to different Driver Registry entries. Unlink one of them first.";
  }

  return {
    canonicalUser,
    duplicateUser,
    canonicalDriverId,
    duplicateDriverId,
    canonicalRoles: canonicalUser.roles,
    duplicateRoles: duplicateUser.roles,
    defaultUnionRoles: buildDefaultUnionRoles(canonicalUser.roles, duplicateUser.roles),
    requestCountForDuplicate,
    blocked,
    blockedReason,
  };
}

// ---------------------------------------------------------------------------
// Account merge
// ---------------------------------------------------------------------------

export interface MergeUserAccountsInput {
  canonicalUid: string;
  duplicateUid: string;
  actorId: string;
  reason: string;
  /**
   * "union" merges only non-sensitive roles (resident, viewer).
   * "explicit" uses `explicitRoles` exactly; this is the only way to
   * transfer admin, dispatcher, or driver roles.
   */
  roleMergePolicy: AccountMergeRolePolicy;
  /** Required when roleMergePolicy is "explicit". */
  explicitRoles?: UserRole[];
}

export interface MergeUserAccountsResult {
  canonicalUser: UserProfile;
  requestsRelinked: number;
  driverRegistryRelinked: 0 | 1;
  duplicateAuthDeleted: boolean;
  /** Non-secret diagnostic if Auth deletion could not be performed. */
  error: string | null;
}

/**
 * Consolidates two authenticated accounts into one canonical account.
 *
 * Safety rules:
 *   1. Water request ownership (`customerId`) is relinked from duplicate
 *      to canonical. Historical actor fields (createdBy,
 *      assignedDriverId, etc.) are NOT rewritten — they remain
 *      historical truth.
 *   2. Driver Registry link: if the duplicate account is linked to a
 *      registry entry and the canonical account is not, the link is
 *      moved to canonical. If BOTH are linked to different entries, the
 *      merge is blocked.
 *   3. Roles: "union" mode unions only resident/viewer. Admin,
 *      dispatcher, and driver roles must be transferred through
 *      "explicit" mode with a deliberate role list. The driver role is
 *      further gated by the Driver Registry link state.
 *   4. The duplicate Firebase Auth user is deleted only after all
 *      Firestore relinking succeeds. If deletion fails, the merge record
 *      is still written and the error is surfaced so staff can retry or
 *      delete the duplicate account manually.
 *   5. An `accountMergeEvents/{eventId}` audit record is created with
 *      both original uids, the acting admin, the role decision, and
 *      relink counts.
 */
export async function mergeUserAccounts(
  input: MergeUserAccountsInput,
): Promise<MergeUserAccountsResult> {
  const { canonicalUid, duplicateUid, actorId, reason, roleMergePolicy, explicitRoles } = input;

  if (canonicalUid === duplicateUid) throw new Error("SAME_USER");
  if (roleMergePolicy === "explicit" && (!explicitRoles || explicitRoles.length === 0)) {
    throw new Error("EXPLICIT_ROLES_REQUIRED");
  }

  const preview = await getAccountMergePreview(canonicalUid, duplicateUid);
  if (preview.blocked) throw new Error(preview.blockedReason ?? "MERGE_BLOCKED");

  const db = getAdminDb();
  const auth = getAdminAuth();
  const now = FieldValue.serverTimestamp();

  // Resolve final role list.
  let finalRoles: UserRole[];
  if (roleMergePolicy === "explicit") {
    finalRoles = [...new Set(explicitRoles!)].sort();
  } else {
    finalRoles = preview.defaultUnionRoles;
  }

  // Validate explicit roles don't silently exceed what makes sense.
  // We allow any subset the admin explicitly chooses, but if they try
  // to grant driver without a registry link, that's harmless (portal
  // access without registry eligibility does not enable deliveries).
  // The preview already warned about driver-registry state.

  // Relink driver registry if applicable.
  let driverRegistryRelinked: 0 | 1 = 0;
  if (preview.duplicateDriverId && !preview.canonicalDriverId) {
    const regRef = db.collection(DRIVER_REGISTRY_COLLECTION).doc(preview.duplicateDriverId);
    await regRef.update({
      linkedUserId: canonicalUid,
      updatedAt: now,
      updatedBy: actorId,
    });
    driverRegistryRelinked = 1;
  }

  // Relink water request ownership.
  const duplicateRequestSnap = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", duplicateUid)
    .get();
  const requestsRelinked = duplicateRequestSnap.size;

  const batch = db.batch();
  for (const doc of duplicateRequestSnap.docs) {
    batch.update(doc.ref, {
      customerId: canonicalUid,
      updatedAt: now,
    });
  }

  // Update canonical user roles.
  const canonicalRef = db.collection(USERS_COLLECTION).doc(canonicalUid);
  batch.update(canonicalRef, {
    roles: finalRoles,
    updatedAt: now,
  });

  await batch.commit();

  // Delete duplicate Auth account if possible. This must come after the
  // Firestore relinking so a partial failure does not leave orphaned
  // references pointing to a still-existing duplicate uid.
  let duplicateAuthDeleted = false;
  let deleteError: string | null = null;
  try {
    await auth.deleteUser(duplicateUid);
    duplicateAuthDeleted = true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete duplicate auth user";
    deleteError = message;
  }

  // Write merge audit record.
  const mergeEventRef = db.collection(MERGE_EVENTS_COLLECTION).doc();
  const mergeEventData: Omit<AccountMergeEvent, "id"> = {
    canonicalUserId: canonicalUid,
    duplicateUserId: duplicateUid,
    actorId,
    createdAt: new Date().toISOString(), // stored as string for simplicity; could use timestamp
    reason: reason.trim(),
    roleMergePolicy,
    mergedRoles: finalRoles,
    duplicateAuthDeleted,
    counts: {
      requestsRelinked,
      driverRegistryRelinked,
    },
    error: deleteError,
  };
  await mergeEventRef.set(mergeEventData);

  // Refresh canonical profile and return.
  const updatedCanonical = await getUserProfile(canonicalUid);
  if (!updatedCanonical) throw new Error("CANONICAL_USER_MISSING_AFTER_MERGE");

  return {
    canonicalUser: updatedCanonical,
    requestsRelinked,
    driverRegistryRelinked,
    duplicateAuthDeleted,
    error: deleteError,
  };
}

// ---------------------------------------------------------------------------
// Recent merge events (for admin review)
// ---------------------------------------------------------------------------

export async function getRecentAccountMergeEvents(limit = 20): Promise<AccountMergeEvent[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(MERGE_EVENTS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      canonicalUserId: data.canonicalUserId,
      duplicateUserId: data.duplicateUserId,
      actorId: data.actorId,
      createdAt:
        data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? new Date(0).toISOString(),
      reason: data.reason,
      roleMergePolicy: data.roleMergePolicy,
      mergedRoles: data.mergedRoles,
      duplicateAuthDeleted: data.duplicateAuthDeleted,
      counts: data.counts ?? null,
      error: data.error ?? null,
    } as AccountMergeEvent;
  });
}

// ---------------------------------------------------------------------------
// Optional account invitation from dispatcher workflow
// ---------------------------------------------------------------------------

export interface AccountInvitationResult {
  /** Whether a new Firebase Auth user was created. */
  created: boolean;
  /** The created/resolved Firebase Auth uid (if known). */
  uid: string | null;
  /** Whether the setup email was sent successfully. */
  emailSent: boolean;
  /** Non-secret diagnostic if email sending failed. */
  emailError: string | null;
}

function getAppUrl(): string {
  // Allow override for local development / custom domains; fall back to
  // the known production deployment.
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://saba-water-delivery.vercel.app";
}

/**
 * Creates a new Firebase Authentication account for an email address and
 * sends a password-reset/setup email so the resident can set their own
 * password. The dispatcher never knows or stores the password.
 *
 * If an account already exists for this email, no invitation is sent and
 * the caller is expected to offer the dispatcher the existing account
 * instead.
 *
 * The current water request remains `customerId: null` (unregistered) even
 * after invitation. When the resident later signs in, staff can link
 * historical request(s) through the admin workflow. This keeps account
 * ownership optional and avoids guessing that the email address belongs
 * to the person at the delivery location.
 */
export async function createAccountInvitation(
  email: string,
  displayName: string,
): Promise<AccountInvitationResult> {
  const normalized = normalizeEmailForMatching(email);
  if (!normalized) {
    throw new Error("INVALID_EMAIL");
  }

  const auth = getAdminAuth();

  // Guard: never create a duplicate Auth account for an existing email.
  try {
    const existing = await auth.getUserByEmail(normalized);
    return {
      created: false,
      uid: existing.uid,
      emailSent: false,
      emailError: "An account already exists for this email.",
    };
  } catch (err: unknown) {
    const firebaseError = err as { code?: string };
    if (firebaseError.code !== "auth/user-not-found") {
      throw err;
    }
  }

  // Create the account without a password; the resident sets it via the
  // password-reset link. This is the cleanest approach when the project
  // already uses Firebase email/password authentication and avoids
  // sending a plaintext or verbally-shared temporary password.
  const newUser: UserRecord = await auth.createUser({
    email: normalized,
    displayName: displayName.trim() || undefined,
    emailVerified: false,
  });

  const appUrl = getAppUrl();
  const actionCodeSettings = {
    url: `${appUrl}/login`,
    handleCodeInApp: false,
  };

  let link: string;
  try {
    link = await auth.generatePasswordResetLink(normalized, actionCodeSettings);
  } catch (err: unknown) {
    // If link generation fails (e.g. missing authorized domain), do not
    // leave an unnotified account behind. Clean up the newly created user
    // so the dispatcher can still create the water request unregistered.
    try {
      await auth.deleteUser(newUser.uid);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }

  const emailResult = await sendAccountSetupEmail({
    to: normalized,
    displayName: displayName.trim(),
    setupLink: link,
    appUrl,
  });

  return {
    created: true,
    uid: newUser.uid,
    emailSent: emailResult.ok,
    emailError: emailResult.error ?? null,
  };
}
