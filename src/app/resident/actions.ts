"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { confirmDeliveryProfile, updateUserProfile } from "@/lib/domain/users";
import {
  confirmWaterDelivery,
  createWaterRequest,
  disputeWaterDelivery,
} from "@/lib/domain/waterRequests";
import { parseWaterSituationFromFormData } from "@/lib/domain/waterSituationForm";

/** Shared, user-facing messages for water-situation validation errors —
 * used by both the resident and dispatcher actions. */
const WATER_SITUATION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_PERSONS_AFFECTED: "Number of people must be a positive whole number.",
  CRITICAL_EXPLANATION_REQUIRED: "Please explain why this request is critical.",
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

/**
 * "Everything Is Correct" on the delivery-profile confirmation reminder
 * (see PRODUCT.md / TECHNICAL.md "Delivery Profile Confirmation
 * Reminder"). Records that the resident affirmatively reviewed their
 * delivery information — never trusts a client-supplied timestamp, and
 * only ever confirms the caller's OWN profile (`requireRole` resolves
 * the session server-side; there is no way to pass another uid in).
 */
export async function confirmDeliveryProfileInfo(
  _prevState: ProfileFormState,
  _formData: FormData,
): Promise<ProfileFormState> {
  const session = await requireRole("resident");

  try {
    await confirmDeliveryProfile(session.uid);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DELIVERY_PROFILE_INCOMPLETE") {
      return {
        status: "error",
        message: "Please complete your phone, village, and delivery directions first.",
      };
    }
    throw err;
  }

  revalidatePath("/resident");
  return { status: "success", message: "Thanks for confirming your delivery information." };
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

  const attestationAccepted = formData.get("attestationAccepted") === "true";

  const waterSituation = parseWaterSituationFromFormData(formData);

  try {
    await createWaterRequest({
      customerId: session.uid,
      village: profile.village,
      deliveryDirections: profile.deliveryDirections,
      preferredDriverId: hasPreferred ? preferredDriverId : null,
      waterSituation,
      attestationAccepted,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "DUPLICATE_ACTIVE_REQUEST") {
        return {
          status: "error",
          message: "You already have an active water request.",
        };
      }
      if (err.message === "ATTESTATION_REQUIRED") {
        return {
          status: "error",
          message: "You must confirm the attestation before submitting the request.",
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
