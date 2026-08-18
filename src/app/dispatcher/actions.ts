"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { restrictDriverAccess, restoreDriverAccess } from "@/lib/domain/drivers";
import {
  cancelWaterRequest,
  dispatcherAssign,
  dispatcherReassign,
  resolveDisputeCompleted,
  resolveDisputeReopened,
} from "@/lib/domain/waterRequests";

// ---------------------------------------------------------------------------
// Helper: verify dispatcher/admin access
// ---------------------------------------------------------------------------

async function requireStaff() {
  return requireRole(["dispatcher", "admin"]);
}

// ---------------------------------------------------------------------------
// Driver management
// ---------------------------------------------------------------------------

export interface DriverActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function restrictDriver(
  _prevState: DriverActionState,
  formData: FormData,
): Promise<DriverActionState> {
  const session = await requireStaff();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await restrictDriverAccess({ driverId, restrictedBy: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver not found." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Delivery access restricted." };
}

export async function restoreDriver(
  _prevState: DriverActionState,
  formData: FormData,
): Promise<DriverActionState> {
  const session = await requireStaff();
  const driverId = String(formData.get("driverId") ?? "").trim();

  if (!driverId) return { status: "error", message: "Missing driver ID." };

  try {
    await restoreDriverAccess({ driverId, restoredBy: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DRIVER_NOT_FOUND") {
      return { status: "error", message: "Driver not found." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Delivery access restored." };
}

// ---------------------------------------------------------------------------
// Request operations
// ---------------------------------------------------------------------------

export interface RequestActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function cancelRequest(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await cancelWaterRequest({ requestId, actorId: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "REQUEST_NOT_FOUND") return { status: "error", message: "Request not found." };
      if (err.message === "REQUEST_ALREADY_RESOLVED") return { status: "error", message: "Request is already resolved." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Request cancelled." };
}

export async function resolveDisputeAsCompleted(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!note) return { status: "error", message: "A resolution note is required." };

  try {
    await resolveDisputeCompleted({ requestId, actorId: session.uid, note });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "REQUEST_NOT_FOUND") return { status: "error", message: "Request not found." };
      if (err.message === "REQUEST_NOT_DISPUTED") return { status: "error", message: "Request is not disputed." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Dispute resolved — delivery accepted." };
}

export async function resolveDisputeAsReopened(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!note) return { status: "error", message: "A resolution note is required." };

  try {
    await resolveDisputeReopened({ requestId, actorId: session.uid, note });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "REQUEST_NOT_FOUND") return { status: "error", message: "Request not found." };
      if (err.message === "REQUEST_NOT_DISPUTED") return { status: "error", message: "Request is not disputed." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Dispute resolved — reopened for new delivery." };
}

export async function assignRequest(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const driverId = String(formData.get("driverId") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!driverId) return { status: "error", message: "Select a driver." };

  try {
    await dispatcherAssign({ requestId, driverId, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND": return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_ASSIGNABLE": return { status: "error", message: "Request is not in an assignable state." };
        case "DRIVER_NOT_FOUND": return { status: "error", message: "Driver not found." };
        case "DRIVER_INELIGIBLE": return { status: "error", message: "Selected driver is not eligible." };
        default: throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Request assigned." };
}

export async function reassignRequest(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const newDriverId = String(formData.get("newDriverId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!newDriverId) return { status: "error", message: "Select a new driver." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await dispatcherReassign({ requestId, newDriverId, actorId: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND": return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMED": return { status: "error", message: "Request is not currently claimed." };
        case "DRIVER_NOT_FOUND": return { status: "error", message: "Driver not found." };
        case "DRIVER_INELIGIBLE": return { status: "error", message: "Selected driver is not eligible." };
        default: throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Request reassigned." };
}
