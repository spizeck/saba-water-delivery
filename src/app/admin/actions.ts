"use server";

import { revalidatePath } from "next/cache";

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { addRole, removeRole } from "@/lib/domain/admin";
import { updateDispatchSettings } from "@/lib/domain/dispatchSettings";
import {
  findPossibleRequestHistoryMatchesForUser,
  linkRequestHistoryToUser,
  mergeUserAccounts,
  getAccountMergePreview,
  type PossibleHistoryMatch,
  type AccountMergePreview,
} from "@/lib/domain/identity";
import { isUserRole } from "@/lib/auth/roles";
import type { UserRole } from "@/lib/domain/types";
import { findUsersByPhone, registerPerson } from "@/lib/domain/users";

// ---------------------------------------------------------------------------
// Helper: verify admin access
// ---------------------------------------------------------------------------

async function requireAdmin() {
  return requireRole("admin");
}

// ---------------------------------------------------------------------------
// Role management
// ---------------------------------------------------------------------------

export interface RoleActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function addUserRole(
  _prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const session = await requireAdmin();
  const targetUid = String(formData.get("targetUid") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!targetUid) return { status: "error", message: "Missing user ID." };
  if (!isUserRole(role)) return { status: "error", message: "Invalid role." };

  try {
    await addRole({ targetUid, role: role as UserRole, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "USER_NOT_FOUND":
          return { status: "error", message: "User not found." };
        case "ROLE_ALREADY_EXISTS":
          return { status: "error", message: `User already has the ${role} role.` };
        case "DRIVER_ROLE_SYSTEM_MANAGED":
          return {
            status: "error",
            message: "The driver role is managed from the Driver Registry.",
          };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/admin");
  return { status: "success", message: `${role} role added.` };
}

export async function removeUserRole(
  _prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const session = await requireAdmin();
  const targetUid = String(formData.get("targetUid") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!targetUid) return { status: "error", message: "Missing user ID." };
  if (!isUserRole(role)) return { status: "error", message: "Invalid role." };

  try {
    await removeRole({ targetUid, role: role as UserRole, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "USER_NOT_FOUND":
          return { status: "error", message: "User not found." };
        case "ROLE_NOT_FOUND":
          return { status: "error", message: `User does not have the ${role} role.` };
        case "CANNOT_REMOVE_RESIDENT":
          return { status: "error", message: "The resident role cannot be removed." };
        case "CANNOT_REMOVE_OWN_ADMIN":
          return { status: "error", message: "You cannot remove your own admin role." };
        case "LAST_ADMIN":
          return { status: "error", message: "Cannot remove the last admin from the system." };
        case "DRIVER_ROLE_SYSTEM_MANAGED":
          return {
            status: "error",
            message: "The driver role is managed from the Driver Registry.",
          };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/admin");
  return { status: "success", message: `${role} role removed.` };
}

// ---------------------------------------------------------------------------
// Note: driver eligibility, account linking, and meter assignments are
// managed from the Driver Registry (/admin/drivers) — see
// src/app/admin/drivers/actions.ts — not here.
// ---------------------------------------------------------------------------
// Dispatch settings
// ---------------------------------------------------------------------------

export interface DispatchSettingsActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function saveDispatchSettings(
  _prevState: DispatchSettingsActionState,
  formData: FormData,
): Promise<DispatchSettingsActionState> {
  const session = await requireAdmin();
  const maxDeclinesPerDay = Number(formData.get("maxDeclinesPerDay"));
  const declineCooldownHours = Number(formData.get("declineCooldownHours"));

  try {
    await updateDispatchSettings({
      maxDeclinesPerDay,
      declineCooldownHours,
      actorId: session.uid,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "INVALID_MAX_DECLINES":
          return {
            status: "error",
            message: "Maximum declines per day must be a whole number of at least 1.",
          };
        case "INVALID_COOLDOWN_HOURS":
          return {
            status: "error",
            message: "Cooldown hours must be a positive number.",
          };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/admin");
  return { status: "success", message: "Dispatch settings saved." };
}

// ---------------------------------------------------------------------------
// Identity linking and account merging
// ---------------------------------------------------------------------------

export type { PossibleHistoryMatch, AccountMergePreview };

export async function getHistoryMatchesForUser(uid: string): Promise<PossibleHistoryMatch[]> {
  await requireAdmin();
  return findPossibleRequestHistoryMatchesForUser(uid);
}

export interface LinkHistoryActionState {
  status: "idle" | "success" | "error";
  message?: string;
  linkedCount?: number;
}

export async function linkHistoryToUser(
  _prevState: LinkHistoryActionState,
  formData: FormData,
): Promise<LinkHistoryActionState> {
  const session = await requireAdmin();

  const targetUid = String(formData.get("targetUid") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const requestIds = formData.getAll("requestIds").map((v) => String(v)).filter(Boolean);

  if (!targetUid) return { status: "error", message: "Missing user ID." };
  if (!reason) return { status: "error", message: "A reason is required." };
  if (requestIds.length === 0) return { status: "error", message: "Select at least one request." };

  try {
    const result = await linkRequestHistoryToUser({
      targetUid,
      requestIds,
      actorId: session.uid,
      reason,
    });
    revalidatePath(`/admin/users/${targetUid}`);
    return {
      status: "success",
      message: `Linked ${result.linkedCount} request(s) to this account.`,
      linkedCount: result.linkedCount,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      const [code] = err.message.split(":");
      switch (code) {
        case "USER_NOT_FOUND":
          return { status: "error", message: "User not found." };
        case "NO_REQUESTS_SELECTED":
          return { status: "error", message: "Select at least one request." };
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "One or more requests were not found." };
        case "REQUEST_ALREADY_LINKED":
          return {
            status: "error",
            message: "One or more requests are no longer unregistered. Refresh and try again.",
          };
      }
    }
    throw err;
  }
}

export interface MergeAccountsActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function getMergeAccountPreview(
  canonicalUid: string,
  duplicateUid: string,
): Promise<AccountMergePreview> {
  await requireAdmin();
  return getAccountMergePreview(canonicalUid, duplicateUid);
}

export async function mergeAccounts(
  _prevState: MergeAccountsActionState,
  formData: FormData,
): Promise<MergeAccountsActionState> {
  const session = await requireAdmin();

  const canonicalUid = String(formData.get("canonicalUid") ?? "").trim();
  const duplicateUid = String(formData.get("duplicateUid") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const roleMergePolicy = String(formData.get("roleMergePolicy") ?? "union");
  const explicitRolesRaw = formData.getAll("explicitRoles").map((v) => String(v)).filter(Boolean);

  if (!canonicalUid || !duplicateUid) {
    return { status: "error", message: "Both accounts are required." };
  }
  if (canonicalUid === duplicateUid) {
    return { status: "error", message: "Cannot merge an account into itself." };
  }
  if (!reason) return { status: "error", message: "A reason is required." };

  const explicitRoles = roleMergePolicy === "explicit" ? explicitRolesRaw : undefined;

  try {
    const result = await mergeUserAccounts({
      canonicalUid,
      duplicateUid,
      actorId: session.uid,
      reason,
      roleMergePolicy: roleMergePolicy === "explicit" ? "explicit" : "union",
      explicitRoles: explicitRoles as UserRole[] | undefined,
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/users/${canonicalUid}`);

    const parts = [`${result.requestsRelinked} request(s) relinked`];
    if (result.driverRegistryRelinked) parts.push("driver registry link moved");
    if (!result.duplicateAuthDeleted && result.error) {
      parts.push(`duplicate auth account could not be deleted (${result.error})`);
    }

    return {
      status: "success",
      message: `Accounts merged. ${parts.join("; ")}.`,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "SAME_USER":
          return { status: "error", message: "Cannot merge an account into itself." };
        case "USER_NOT_FOUND":
          return { status: "error", message: "One or both users were not found." };
        case "MERGE_BLOCKED":
          return { status: "error", message: "These accounts cannot be merged." };
        case "EXPLICIT_ROLES_REQUIRED":
          return { status: "error", message: "Select the final roles for explicit merge." };
        default:
          return { status: "error", message: err.message };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Staff person registration
// ---------------------------------------------------------------------------

export interface RegisterPersonActionState {
  status: "idle" | "success" | "error" | "duplicate_warning";
  message?: string;
  duplicates?: Array<{ uid: string; displayName: string; phone: string | null; email: string | null }>;
  createdUid?: string;
}

/**
 * Registers a new person in the system without requiring Firebase Auth
 * credentials. The person can immediately receive water and appear in
 * the resident directory, but cannot log in until a future auth method
 * (e.g. SMS) is linked.
 */
export async function registerPersonAction(
  _prevState: RegisterPersonActionState,
  formData: FormData,
): Promise<RegisterPersonActionState> {
  const session = await requireRole(["admin", "dispatcher"]);

  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const village = String(formData.get("village") ?? "").trim() || null;
  const deliveryDirections = String(formData.get("deliveryDirections") ?? "").trim() || null;
  const overrideDuplicate = formData.get("overrideDuplicate") === "true";

  // Parse roles from form
  const rolesRaw = formData.getAll("roles").map((v) => String(v));
  const roles: UserRole[] = rolesRaw.filter(isUserRole) as UserRole[];

  if (!displayName) return { status: "error", message: "Full name is required." };
  if (!phone) return { status: "error", message: "Phone number is required." };

  // Check for existing accounts with the same phone
  if (!overrideDuplicate) {
    const existing = await findUsersByPhone(phone);
    if (existing.length > 0) {
      return {
        status: "duplicate_warning",
        message: `${existing.length} existing account(s) found with this phone number.`,
        duplicates: existing.map((u) => ({
          uid: u.uid,
          displayName: u.displayName,
          phone: u.phone,
          email: u.email,
        })),
      };
    }
  }

  try {
    const { profile } = await registerPerson({
      displayName,
      phone,
      email,
      village,
      deliveryDirections,
      roles,
      registeredBy: session.uid,
    });

    revalidatePath("/admin");
    redirect(`/admin/users/${profile.uid}`);
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "DISPLAY_NAME_REQUIRED":
          return { status: "error", message: "Full name is required." };
        case "PHONE_REQUIRED":
          return { status: "error", message: "Phone number is required." };
        case "INVALID_VILLAGE":
          return { status: "error", message: "Please select a valid village." };
        default:
          // Re-throw Next.js redirect errors
          throw err;
      }
    }
    throw err;
  }
}
