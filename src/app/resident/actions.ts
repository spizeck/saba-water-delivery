"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { updateUserProfile } from "@/lib/domain/users";
import {
  confirmWaterDelivery,
  createWaterRequest,
  disputeWaterDelivery,
} from "@/lib/domain/waterRequests";
import { parseWaterSituationFromFormData } from "@/lib/domain/waterSituationForm";

/** Shared, user-facing messages for water-situation validation errors —
 * used by both the resident and dispatcher actions. */
const WATER_SITUATION_ERROR_MESSAGES: Record<string, string> = {
  VULNERABLE_OTHER_DETAIL_REQUIRED:
    "Please briefly describe the \"Other\" circumstance, or unselect it.",
  INVALID_PERSONS_AFFECTED: "Number of people must be a positive whole number.",
  INVALID_AVAILABLE_STORAGE: "Available storage capacity must be zero or more.",
  AVAILABLE_STORAGE_BELOW_STANDARD:
    "Available capacity should be at least 1,000 gallons (the standard delivery amount). Please double-check this value.",
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function updateResidentProfile(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  // Re-verify on the server: never trust that the form was only reachable
  // by a resident just because the page rendered it.
  const session = await requireRole("resident");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const village = String(formData.get("village") ?? "").trim();
  const deliveryDirections = String(formData.get("deliveryDirections") ?? "").trim();

  if (!displayName) {
    return { status: "error", message: "Display name is required." };
  }
  if (!village) {
    return { status: "error", message: "Village/area is required." };
  }
  if (!deliveryDirections) {
    return { status: "error", message: "Delivery directions are required." };
  }

  await updateUserProfile({
    uid: session.uid,
    displayName,
    phone: phone || null,
    village,
    deliveryDirections,
  });

  revalidatePath("/resident");
  return { status: "success", message: "Profile saved." };
}

// ---------------------------------------------------------------------------
// Water request
// ---------------------------------------------------------------------------

export interface RequestWaterFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function requestWater(
  _prevState: RequestWaterFormState,
  formData: FormData,
): Promise<RequestWaterFormState> {
  const session = await requireRole("resident");
  const { profile } = session;

  // Server-side validation: profile must be complete.
  if (!profile.village?.trim() || !profile.deliveryDirections?.trim()) {
    return {
      status: "error",
      message: "Please complete your profile before requesting water.",
    };
  }

  // Extract preferred driver choice. Empty string or "none" means no preference.
  const preferredDriverId = String(formData.get("preferredDriverId") ?? "").trim();
  const hasPreferred = preferredDriverId && preferredDriverId !== "none";

  // Resident form has no capacity-override flag — a below-standard value
  // is always treated as a likely data-entry error (see PRODUCT.md
  // "Available Storage Capacity").
  const waterSituation = parseWaterSituationFromFormData(formData);

  try {
    await createWaterRequest({
      customerId: session.uid,
      village: profile.village,
      deliveryDirections: profile.deliveryDirections,
      preferredDriverId: hasPreferred ? preferredDriverId : null,
      waterSituation,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "DUPLICATE_ACTIVE_REQUEST") {
        return {
          status: "error",
          message: "You already have an active water request.",
        };
      }
      const situationMessage = WATER_SITUATION_ERROR_MESSAGES[err.message];
      if (situationMessage) {
        return { status: "error", message: situationMessage };
      }
    }
    throw err;
  }

  revalidatePath("/resident");
  return { status: "success", message: "Water request submitted." };
}

// ---------------------------------------------------------------------------
// Delivery confirmation
// ---------------------------------------------------------------------------

export interface DeliveryResponseState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function confirmDelivery(
  _prevState: DeliveryResponseState,
  formData: FormData,
): Promise<DeliveryResponseState> {
  const session = await requireRole("resident");
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) {
    return { status: "error", message: "Missing request ID." };
  }

  try {
    await confirmWaterDelivery({
      requestId,
      customerId: session.uid,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "NOT_REQUEST_OWNER":
          return { status: "error", message: "This is not your request." };
        case "INVALID_STATUS_FOR_CONFIRM":
          return { status: "error", message: "This delivery cannot be confirmed right now." };
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/resident");
  return { status: "success", message: "Delivery confirmed. Thank you!" };
}

// ---------------------------------------------------------------------------
// Delivery dispute
// ---------------------------------------------------------------------------

export async function disputeDelivery(
  _prevState: DeliveryResponseState,
  formData: FormData,
): Promise<DeliveryResponseState> {
  const session = await requireRole("resident");
  const requestId = String(formData.get("requestId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!requestId) {
    return { status: "error", message: "Missing request ID." };
  }

  try {
    await disputeWaterDelivery({
      requestId,
      customerId: session.uid,
      reason: reason || undefined,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "NOT_REQUEST_OWNER":
          return { status: "error", message: "This is not your request." };
        case "INVALID_STATUS_FOR_DISPUTE":
          return { status: "error", message: "This delivery cannot be disputed right now." };
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/resident");
  return { status: "success", message: "Issue reported. The water office will review." };
}
