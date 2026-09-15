import "server-only";

import { type UserRecord } from "firebase-admin/auth";
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";

import { getAppOrigin } from "@/lib/config/appOrigin";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { toUserRoles } from "@/lib/auth/roles";

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
import {
  initialMergeAuthReconciliation,
  reconcileMergeAuthEvent,
  type MergeAuthOps,
} from "./mergeReconciliation";
import { toWaterRequest } from "./waterRequests";
import {
  readAdminPopulationInTransaction,
  recordAdminInvariantParticipation,
} from "./admin";
import { sendAccountSetupEmail } from "@/lib/email/accountSetupEmail";

const REQUESTS_COLLECTION = "waterRequests";
const USERS_COLLECTION = "users";
const DRIVER_REGISTRY_COLLECTION = "driverRegistry";
const MERGE_EVENTS_COLLECTION = "accountMergeEvents";

/**
 * Firestore's hard limit on the number of writes in a single transaction or
 * batched write.
 */
const FIRESTORE_MAX_TXN_WRITES = 500;

/**
 * Non-request writes the atomic merge transaction can perform besides the
 * per-request `customerId` relinks: the canonical role update, the duplicate
 * admin-revocation update, the shared last-admin invariant document, the
 * driver-registry relink, and the `accountMergeEvents` audit record. The merge
 * caps request relinks so that this fixed overhead plus the relinks can never
 * exceed {@link FIRESTORE_MAX_TXN_WRITES}.
 */
const MERGE_TXN_NON_REQUEST_WRITES = 5;

/**
 * Maximum number of duplicate-owned water requests an account merge will relink.
 * Since issue #49 the entire merge — canonical role change, duplicate admin
 * revocation, driver-registry relink, request relinks, AND the
 * `accountMergeEvents` audit record — commits in ONE Firestore transaction, so
 * this cap leaves headroom for the fixed non-request writes and the whole
 * transaction stays within {@link FIRESTORE_MAX_TXN_WRITES}. A merge of an
 * account owning more than this is rejected BEFORE any write
 * (`MERGE_TOO_MANY_REQUESTS`) so it fails closed rather than exceeding the write
 * limit mid-commit. Implausible at Saba's scale (a resident never owns hundreds
 * of requests). The only merge state that is NOT part of the transaction is the
 * external Firebase Auth account deletion, which cannot join a Firestore
 * transaction — see the note in {@link mergeUserAccounts}.
 */
const MAX_MERGE_REQUEST_RELINKS =
  FIRESTORE_MAX_TXN_WRITES - MERGE_TXN_NON_REQUEST_WRITES;

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
export async function getEmailAccountStatus(
  email: string,
): Promise<EmailAccountStatus> {
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
export {
  findIdentityMatches,
  normalizeEmailForMatching,
  normalizePhoneForMatching,
};

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
  const snapshot = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", null)
    .get();

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
      new Date(b.request.requestedAt).getTime() -
      new Date(a.request.requestedAt).getTime(),
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
    const refs = uniqueIds.map((id) =>
      db.collection(REQUESTS_COLLECTION).doc(id),
    );
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

  if (
    canonicalDriverId &&
    duplicateDriverId &&
    canonicalDriverId !== duplicateDriverId
  ) {
    blocked = true;
    blockedReason =
      "Both accounts are linked to different Driver Registry entries. Unlink one of them first.";
  }

  // A merged-away account can never participate in another merge: it can
  // neither be a survivor (its identity is dead) nor a duplicate again
  // (re-pointing mergedIntoUserId would corrupt the audit trail).
  if (canonicalUser.mergedIntoUserId || duplicateUser.mergedIntoUserId) {
    blocked = true;
    blockedReason =
      "One of these accounts was already merged into another account.";
  }

  return {
    canonicalUser,
    duplicateUser,
    canonicalDriverId,
    duplicateDriverId,
    canonicalRoles: canonicalUser.roles,
    duplicateRoles: duplicateUser.roles,
    defaultUnionRoles: buildDefaultUnionRoles(
      canonicalUser.roles,
      duplicateUser.roles,
    ),
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
  /**
   * Whether the merged-away Firebase Auth identity is gone (deleted or
   * proven absent). False means reconciliation is still pending or
   * failed — but the identity is already application-rejected via the
   * `mergedIntoUserId` marker regardless.
   */
  duplicateAuthDeleted: boolean;
  /** Sanitized reconciliation state after the immediate attempt. */
  authReconciliation: "reconciled" | "pending" | "failed" | "unknown";
  /**
   * Whether the merged-away Auth identity was observed disabled — the
   * interim safe state while deletion is pending.
   */
  duplicateAuthDisabled: boolean;
  /** Sanitized diagnostic if Auth reconciliation did not finish. */
  error: string | null;
}

/**
 * Consolidates two authenticated accounts into one canonical account.
 *
 * Atomicity (issue #49): every Firestore effect of the merge — canonical role
 * change, duplicate admin revocation, shared last-admin invariant
 * participation, driver-registry relink, request-ownership relinks, the
 * merged-away marker on the duplicate's profile, AND the `accountMergeEvents`
 * audit record (including its `authReconciliation` sub-record) — commits in
 * ONE Firestore transaction, so no sensitive state can commit without its
 * durable business-history event and its durable reconciliation record.
 * The one merge side effect that cannot join that transaction is the external
 * Firebase Auth cleanup (Firebase Auth is not a Firestore participant); it is
 * made durable and resumable by the reconciliation worker — see
 * `mergeReconciliation.ts` and ADR 0018.
 *
 * Safety rules:
 *   1. Water request ownership (`customerId`) is relinked from duplicate
 *      to canonical. Historical actor fields (createdBy,
 *      assignedDriverId, etc.) are NOT rewritten — they remain
 *      historical truth.
 *   2. Driver Registry link: if the duplicate account is linked to a
 *      registry entry and the canonical account is not, the link is
 *      moved to canonical. If BOTH are linked to different entries, the
 *      merge is blocked. The relink is applied inside the transaction
 *      against a fresh read, so a concurrent unlink cannot strand it.
 *   3. Roles: "union" mode unions only resident/viewer. Admin,
 *      dispatcher, and driver roles must be transferred through
 *      "explicit" mode with a deliberate role list. The driver role is
 *      further gated by the Driver Registry link state.
 *   4. The duplicate's `users` document gets `mergedIntoUserId` INSIDE the
 *      transaction — so from the moment the merge commits, the merged-away
 *      identity is rejected by application authentication boundaries even
 *      while the Auth identity still exists. The Auth-side convergence
 *      (disable → revoke → delete) then runs: immediately here (best effort),
 *      and durably retried by the reconciliation sweep on any failure or
 *      crash — see `reconcileMergeAuthEvent`. Auth failure never rolls back
 *      or corrupts the committed Firestore merge.
 *   5. The `accountMergeEvents/{eventId}` audit record (both original uids,
 *      the acting admin, the role decision, relink counts, whether the
 *      duplicate's admin role was revoked, and the durable
 *      `authReconciliation` state machine) is written INSIDE the transaction,
 *      so the reconciliation work is discoverable even if this process dies
 *      immediately after the commit.
 */
export async function mergeUserAccounts(
  input: MergeUserAccountsInput,
  options: { auth?: MergeAuthOps } = {},
): Promise<MergeUserAccountsResult> {
  const {
    canonicalUid,
    duplicateUid,
    actorId,
    reason,
    roleMergePolicy,
    explicitRoles,
  } = input;

  if (canonicalUid === duplicateUid) throw new Error("SAME_USER");
  if (
    roleMergePolicy === "explicit" &&
    (!explicitRoles || explicitRoles.length === 0)
  ) {
    throw new Error("EXPLICIT_ROLES_REQUIRED");
  }

  const preview = await getAccountMergePreview(canonicalUid, duplicateUid);
  if (preview.blocked)
    throw new Error(preview.blockedReason ?? "MERGE_BLOCKED");

  const db = getAdminDb();

  // Resolve final role list. "union" uses the preview's non-sensitive union;
  // "explicit" uses the admin's exact choice — the only way to move admin/
  // dispatcher/driver. The last-admin SAFETY decision below never trusts the
  // preview; it re-reads live state inside the transaction.
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

  const canonicalRef = db.collection(USERS_COLLECTION).doc(canonicalUid);
  const duplicateRef = db.collection(USERS_COLLECTION).doc(duplicateUid);

  // Fail closed BEFORE opening the transaction if the duplicate owns more
  // requests than can be relinked within Firestore's per-transaction write
  // limit (alongside the fixed merge writes). A cheap aggregation count avoids
  // reading every request document just to reject; the authoritative check is
  // repeated INSIDE the transaction against the transactionally-consistent set.
  const duplicateRequestCountSnap = await db
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", duplicateUid)
    .count()
    .get();
  if (duplicateRequestCountSnap.data().count > MAX_MERGE_REQUEST_RELINKS) {
    throw new Error("MERGE_TOO_MANY_REQUESTS");
  }

  // Stable audit-record id + timestamp across transaction retries.
  const mergeEventRef = db.collection(MERGE_EVENTS_COLLECTION).doc();
  const mergeCreatedAt = new Date().toISOString();

  // Whether the duplicate registry entry should be relinked to canonical is
  // decided from the (UI) preview, but the relink itself is performed inside
  // the transaction against a fresh read.
  const duplicateDriverIdToRelink =
    preview.duplicateDriverId && !preview.canonicalDriverId
      ? preview.duplicateDriverId
      : null;

  // ONE transaction commits every Firestore effect of the merge so no sensitive
  // state can commit without its durable audit record (issue #49). The
  // last-admin invariant (issue #70 + the "phantom admin" fix) is preserved:
  // whether the merge reduces the usable admin population is decided from FRESH
  // reads of the canonical/duplicate documents and the live admin set — NEVER
  // the non-transactional `preview` (which is UI input only; letting it gate
  // the write path would let a canonical or duplicate that concurrently gained
  // `admin` slip past the guard — review #70 / Aikido). A merge reduces usable
  // admins in two ways, both handled atomically here:
  //   1. the canonical loses `admin` (finalRoles omits it while it held it);
  //   2. the duplicate is decommissioned — its Firebase Auth identity is deleted
  //      below — so if it holds `admin` that role is revoked from the leftover
  //      document to avoid a counted-but-unusable "phantom admin". Other roles
  //      are preserved for historical linkage.
  // When either applies, the transaction reads+writes the shared
  // `systemInvariants/adminRole` document (serializing against concurrent
  // `removeRole`s and merges) and rejects with `LAST_ADMIN` if zero usable
  // admins would remain. Any rejection aborts the whole transaction, so the
  // merge fails closed with no partial state and no audit record.
  let duplicateAdminRevoked = false;
  let requestsRelinked = 0;
  let driverRegistryRelinked: 0 | 1 = 0;
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (txn) => {
    // ---- All reads first (Firestore requires all reads before all writes) ----
    const canonicalSnap = await txn.get(canonicalRef);
    if (!canonicalSnap.exists) throw new Error("USER_NOT_FOUND");
    const duplicateSnap = await txn.get(duplicateRef);
    if (!duplicateSnap.exists) throw new Error("USER_NOT_FOUND");

    // A merged-away account can never participate in another merge — re-checked
    // inside the transaction so a concurrent merge cannot race past the preview.
    if (
      canonicalSnap.data()!.mergedIntoUserId ||
      duplicateSnap.data()!.mergedIntoUserId
    ) {
      throw new Error("ALREADY_MERGED");
    }

    // Authoritative, transactionally-consistent set of requests to relink.
    const duplicateRequestSnap = await txn.get(
      db
        .collection(REQUESTS_COLLECTION)
        .where("customerId", "==", duplicateUid),
    );
    // Re-check against the live set: if the duplicate acquired more requests
    // since the pre-check, still fail closed rather than exceed the write limit.
    if (duplicateRequestSnap.size > MAX_MERGE_REQUEST_RELINKS) {
      throw new Error("MERGE_TOO_MANY_REQUESTS");
    }

    // Driver-registry relink target, read inside the transaction so a
    // concurrent unlink/relink cannot strand a stale write.
    let registryRelinkRef: DocumentReference | null = null;
    if (duplicateDriverIdToRelink) {
      const regRef = db
        .collection(DRIVER_REGISTRY_COLLECTION)
        .doc(duplicateDriverIdToRelink);
      const regSnap = await txn.get(regRef);
      if (regSnap.exists && regSnap.data()!.linkedUserId === duplicateUid) {
        registryRelinkRef = regRef;
      }
    }

    const canonicalRolesLive = toUserRoles(canonicalSnap.data()!.roles);
    const duplicateRolesLive = toUserRoles(duplicateSnap.data()!.roles);
    const finalKeepsCanonicalAdmin = finalRoles.includes("admin");
    const canonicalLosesAdmin =
      canonicalRolesLive.includes("admin") && !finalKeepsCanonicalAdmin;
    const duplicateLosesAdmin = duplicateRolesLive.includes("admin");
    const reducesAdmins = canonicalLosesAdmin || duplicateLosesAdmin;

    // Only an admin-reducing merge touches the shared invariant document.
    let invariantSnap: DocumentSnapshot | null = null;
    let afterAdminCount = 0;
    if (reducesAdmins) {
      const pop = await readAdminPopulationInTransaction(db, txn);
      invariantSnap = pop.invariantSnap;
      // Effective admin set AFTER this merge, from the LIVE admin set:
      //  - the canonical's roles become finalRoles;
      //  - the duplicate is decommissioned, so it is never an admin afterwards.
      const afterAdmins = new Set(pop.adminUids);
      afterAdmins.delete(canonicalUid);
      afterAdmins.delete(duplicateUid);
      if (finalKeepsCanonicalAdmin) afterAdmins.add(canonicalUid);
      if (afterAdmins.size < 1) throw new Error("LAST_ADMIN");
      afterAdminCount = afterAdmins.size;
    }

    // ---- All writes after reads ----
    // Reset per-attempt so a transaction retry cannot carry stale values.
    duplicateAdminRevoked = false;
    driverRegistryRelinked = 0;

    txn.update(canonicalRef, { roles: finalRoles, updatedAt: now });

    // Always stamp the merged-away marker on the duplicate's profile inside
    // the same commit — it is the immediate, application-level guarantee that
    // the merged-away uid can no longer authenticate, independent of how the
    // external Auth cleanup proceeds (issue #73). The duplicate's admin role
    // is additionally revoked when it held one (phantom-admin prevention).
    txn.update(duplicateRef, {
      mergedIntoUserId: canonicalUid,
      ...(duplicateLosesAdmin
        ? { roles: duplicateRolesLive.filter((r) => r !== "admin") }
        : {}),
      updatedAt: now,
    });
    if (duplicateLosesAdmin) {
      duplicateAdminRevoked = true;
    }

    if (reducesAdmins) {
      recordAdminInvariantParticipation(
        db,
        txn,
        invariantSnap!,
        afterAdminCount,
        actorId,
      );
    }

    if (registryRelinkRef) {
      txn.update(registryRelinkRef, {
        linkedUserId: canonicalUid,
        updatedAt: now,
        updatedBy: actorId,
      });
      driverRegistryRelinked = 1;
    }

    for (const doc of duplicateRequestSnap.docs) {
      txn.update(doc.ref, { customerId: canonicalUid, updatedAt: now });
    }
    requestsRelinked = duplicateRequestSnap.size;

    // Audit record — committed in the SAME transaction as every state change
    // above (issue #49). `duplicateAuthDeleted` starts false because the
    // external Auth cleanup happens only after this transaction commits, and
    // the durable `authReconciliation` sub-record is born `pending` so the
    // work survives any crash between commit and cleanup (issue #73).
    const mergeEventData = {
      canonicalUserId: canonicalUid,
      duplicateUserId: duplicateUid,
      actorId,
      createdAt: mergeCreatedAt, // stored as string for simplicity; could use timestamp
      reason: reason.trim(),
      roleMergePolicy,
      mergedRoles: finalRoles,
      duplicateAuthDeleted: false,
      duplicateAdminRevoked,
      counts: {
        requestsRelinked,
        driverRegistryRelinked,
      },
      error: null,
      authReconciliation: initialMergeAuthReconciliation(),
    };
    txn.set(mergeEventRef, mergeEventData);
  });

  // Reconcile the merged-away Firebase Auth identity — the one merge side
  // effect that cannot join the Firestore transaction. It runs AFTER the
  // commit so a transaction failure never touches an Auth account for a merge
  // that did not happen. The attempt is best effort (most merges reconcile
  // here): the durable `authReconciliation` sub-record already exists inside
  // the commit, so any failure or crash is automatically retried by the
  // hourly sweep — and from the commit onward the merged-away uid is already
  // rejected at the application's authentication boundaries via
  // `mergedIntoUserId` (issue #73). Failure categories are sanitized by the
  // reconciler; no provider error payload ever reaches the caller.
  const reconciliation = await reconcileMergeAuthEvent(mergeEventRef.id, {
    ...(options.auth ? { auth: options.auth } : {}),
  });

  const duplicateAuthDeleted = reconciliation.status === "reconciled";
  const authReconciliation: MergeUserAccountsResult["authReconciliation"] =
    reconciliation.status === "reconciled"
      ? "reconciled"
      : reconciliation.status === "retry_scheduled" ||
          reconciliation.status === "error" ||
          reconciliation.status === "skipped"
        ? "pending"
        : reconciliation.status === "failed" ||
            reconciliation.status === "invalid_record"
          ? "failed"
          : "unknown";
  const duplicateAuthDisabled =
    "duplicateDisabled" in reconciliation
      ? reconciliation.duplicateDisabled
      : false;
  const reconcileError =
    reconciliation.status === "reconciled" ||
    reconciliation.status === "already_resolved"
      ? null
      : reconciliation.status === "retry_scheduled" ||
          reconciliation.status === "failed"
        ? reconciliation.category
        : reconciliation.status === "invalid_record"
          ? "invalid_record"
          : reconciliation.status === "error"
            ? "internal_error"
            : "pending";

  // Refresh canonical profile and return.
  const updatedCanonical = await getUserProfile(canonicalUid);
  if (!updatedCanonical) throw new Error("CANONICAL_USER_MISSING_AFTER_MERGE");

  return {
    canonicalUser: updatedCanonical,
    requestsRelinked,
    driverRegistryRelinked,
    duplicateAuthDeleted:
      duplicateAuthDeleted || reconciliation.status === "already_resolved",
    authReconciliation,
    duplicateAuthDisabled,
    error: reconcileError,
  };
}

// ---------------------------------------------------------------------------
// Recent merge events (for admin review)
// ---------------------------------------------------------------------------

export async function getRecentAccountMergeEvents(
  limit = 20,
): Promise<AccountMergeEvent[]> {
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
        data.createdAt?.toDate?.()?.toISOString?.() ??
        data.createdAt ??
        new Date(0).toISOString(),
      reason: data.reason,
      roleMergePolicy: data.roleMergePolicy,
      mergedRoles: data.mergedRoles,
      duplicateAuthDeleted: data.duplicateAuthDeleted,
      duplicateAdminRevoked: data.duplicateAdminRevoked ?? false,
      counts: data.counts ?? null,
      error: data.error ?? null,
      authReconciliation: data.authReconciliation
        ? {
            state: data.authReconciliation.state,
            attemptCount:
              typeof data.authReconciliation.attemptCount === "number"
                ? data.authReconciliation.attemptCount
                : 0,
            nextAttemptAt:
              data.authReconciliation.nextAttemptAt
                ?.toDate?.()
                ?.toISOString?.() ?? null,
            lastAttemptAt:
              data.authReconciliation.lastAttemptAt
                ?.toDate?.()
                ?.toISOString?.() ?? null,
            lastFailureCategory:
              data.authReconciliation.lastFailureCategory ?? null,
            duplicateDisabled:
              data.authReconciliation.duplicateDisabled === true,
            reconciledAt:
              data.authReconciliation.reconciledAt
                ?.toDate?.()
                ?.toISOString?.() ?? null,
            leaseExpiresAt:
              data.authReconciliation.leaseExpiresAt
                ?.toDate?.()
                ?.toISOString?.() ?? null,
          }
        : null,
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
  // Canonical, validated, trailing-slash-normalized app origin (issue #54).
  return getAppOrigin();
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
