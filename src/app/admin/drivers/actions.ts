"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import {
  createDriver,
  linkDriverAccount,
  removeMeterAssignment,
  restoreDriver,
  restrictDriver,
  seedInitialRoster,
  setMeterAssignment,
  unlinkDriverAccount,
  updateDriver,
} from "@/lib/domain/driverRegistry";

async function requireAdmin() {
  return requireRole("admin");
}

// ---------------------------------------------------------------------------
// Create / edit basic info
// ---------------------------------------------------------------------------

export interface DriverFormActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function createDriverAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!displayName) return { status: "error", message: "Name is required." };

  try {
    await createDriver({ displayName, phone: phone || null, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DISPLAY_NAME_REQUIRED") {
      return { status: "error", message: "Name is required." };
    }
    throw err;
  }

  revalidatePath("/admin/drivers");
  return { status: "success", message: "Driver added to the registry." };
}

export async function updateDriverAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!displayName) return { status: "error", message: "Name is required." };

  try {
    await updateDriver({ driverId, displayName, phone: phone || null, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "DRIVER_NOT_FOUND") return { status: "error", message: "Driver not found." };
      if (err.message === "DISPLAY_NAME_REQUIRED") return { status: "error", message: "Name is required." };
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Driver details updated." };
}

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------

export async function linkDriverAccountAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!userId) return { status: "error", message: "Select an account to link." };

  try {
    await linkDriverAccount({ driverId, userId, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver not found." };
        case "DRIVER_ALREADY_LINKED":
          return { status: "error", message: "This driver is already linked to an account." };
        case "USER_NOT_FOUND":
          return { status: "error", message: "Account not found." };
        case "USER_ALREADY_LINKED":
          return { status: "error", message: "That account is already linked to a different driver." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Account linked." };
}

export async function unlinkDriverAccountAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };

  try {
    await unlinkDriverAccount({ driverId, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver not found." };
        case "DRIVER_NOT_LINKED":
          return { status: "error", message: "This driver has no linked account." };
        case "DRIVER_HAS_ACTIVE_DELIVERIES":
          return {
            status: "error",
            message: "This driver has active claimed deliveries. Resolve or reassign them first.",
          };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Account unlinked." };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export async function restrictDriverEntryAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await restrictDriver({ driverId, restrictedBy: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver not found." };
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Delivery access restricted." };
}

export async function restoreDriverEntryAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };

  try {
    await restoreDriver({ driverId, restoredBy: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver not found." };
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Delivery access restored." };
}

// ---------------------------------------------------------------------------
// Meter assignments
// ---------------------------------------------------------------------------

export async function setMeterAssignmentAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const stationId = String(formData.get("stationId") ?? "").trim();
  const meterCode = String(formData.get("meterCode") ?? "").trim();
  const meterNumber = Number(formData.get("meterNumber"));

  if (!driverId || !stationId) return { status: "error", message: "Missing driver or station." };

  try {
    await setMeterAssignment({ driverId, stationId, meterCode, meterNumber, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "METER_CODE_REQUIRED") return { status: "error", message: "Meter code is required." };
      if (err.message === "INVALID_METER_NUMBER") return { status: "error", message: "Meter number must be a non-negative number." };
      if (err.message === "DRIVER_NOT_FOUND") return { status: "error", message: "Driver not found." };
    }
    throw err;
  }

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Meter assignment saved." };
}

export async function removeMeterAssignmentAction(
  _prevState: DriverFormActionState,
  formData: FormData,
): Promise<DriverFormActionState> {
  const session = await requireAdmin();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const stationId = String(formData.get("stationId") ?? "").trim();

  if (!driverId || !stationId) return { status: "error", message: "Missing driver or station." };

  await removeMeterAssignment({ driverId, stationId, actorId: session.uid });

  revalidatePath(`/admin/drivers/${driverId}`);
  return { status: "success", message: "Meter assignment removed." };
}

// ---------------------------------------------------------------------------
// Registry maintenance (manual, explicit — never automatic)
// ---------------------------------------------------------------------------

export interface MaintenanceActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function seedInitialRosterAction(
  _prevState: MaintenanceActionState,
): Promise<MaintenanceActionState> {
  const session = await requireAdmin();
  const result = await seedInitialRoster(session.uid);
  revalidatePath("/admin/drivers");
  return {
    status: "success",
    message: `${result.created} driver(s) added, ${result.skipped} already existed.`,
  };
}
