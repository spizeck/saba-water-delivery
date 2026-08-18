"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { addRole, removeRole, getActiveDeliveryCount } from "@/lib/domain/admin";
import { restrictDriverAccess, restoreDriverAccess } from "@/lib/domain/drivers";
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
  /** Number of active deliveries — set when warning needed. */
  activeDeliveries?: number;
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
  const confirmed = formData.get("confirmed") === "true";

  if (!targetUid) return { status: "error", message: "Missing user ID." };
  if (!isUserRole(role)) return { status: "error", message: "Invalid role." };

  // If removing driver role, check for active deliveries and warn if not confirmed.
  if (role === "driver" && !confirmed) {
    const activeCount = await getActiveDeliveryCount(targetUid);
    if (activeCount > 0) {
      return {
        status: "error",
        message: `This driver has ${activeCount} active delivery assignment(s). Removing the driver role will NOT cancel or reassign them. Confirm to proceed.`,
        activeDeliveries: activeCount,
      };
    }
  }

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
// Driver eligibility management
// ---------------------------------------------------------------------------

export interface DriverActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function adminRestrictDriver(
  _prevState: DriverActionState,
  formData: FormData,
): Promise<DriverActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await restrictDriverAccess({ driverId, restrictedBy: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver profile not found." };
    }
    throw err;
  }

  revalidatePath("/admin");
  return { status: "success", message: "Delivery access restricted." };
}

export async function adminRestoreDriver(
  _prevState: DriverActionState,
  formData: FormData,
): Promise<DriverActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };

  try {
    await restoreDriverAccess({ driverId, restoredBy: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver profile not found." };
    }
    throw err;
  }

  revalidatePath("/admin");
  return { status: "success", message: "Delivery access restored." };
}
