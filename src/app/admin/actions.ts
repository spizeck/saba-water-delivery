"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { addRole, removeRole } from "@/lib/domain/admin";
import { updateDispatchSettings } from "@/lib/domain/dispatchSettings";
import { isUserRole } from "@/lib/auth/roles";
import type { UserRole } from "@/lib/domain/types";

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
