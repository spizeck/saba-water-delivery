"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { setDriverAvailability } from "@/lib/domain/drivers";
import { claimWaterRequest } from "@/lib/domain/waterRequests";
import type { DriverAvailabilityStatus } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Availability toggle
// ---------------------------------------------------------------------------

export interface AvailabilityActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function toggleAvailability(
  _prevState: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const session = await requireRole("driver");
  const newStatus = String(formData.get("availabilityStatus") ?? "") as DriverAvailabilityStatus;

  if (newStatus !== "online" && newStatus !== "offline") {
    return { status: "error", message: "Invalid availability status." };
  }

  await setDriverAvailability({
    driverId: session.uid,
    availabilityStatus: newStatus,
  });

  revalidatePath("/driver");
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Claim request
// ---------------------------------------------------------------------------

export interface ClaimActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function claimRequest(
  _prevState: ClaimActionState,
  formData: FormData,
): Promise<ClaimActionState> {
  const session = await requireRole("driver");
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) {
    return { status: "error", message: "Missing request ID." };
  }

  try {
    await claimWaterRequest({
      requestId,
      driverId: session.uid,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "ALREADY_CLAIMED":
          return { status: "error", message: "This request was already claimed by another driver." };
        case "PREFERRED_DRIVER_RESTRICTION":
          return { status: "error", message: "This request is reserved for a preferred driver." };
        case "HOLD_EXPIRED":
          return { status: "error", message: "The preferred-driver hold has expired. Please refresh." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is no longer available." };
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "DRIVER_INELIGIBLE":
          return { status: "error", message: "You are not currently eligible to claim requests." };
        case "DRIVER_OFFLINE":
          return { status: "error", message: "You must be online to claim requests." };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver profile not found." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/driver");
  return { status: "success", message: "Delivery claimed!" };
}
