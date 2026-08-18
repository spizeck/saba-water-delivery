"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { updateUserProfile } from "@/lib/domain/users";
import { createWaterRequest } from "@/lib/domain/waterRequests";

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

  try {
    await createWaterRequest({
      customerId: session.uid,
      village: profile.village,
      deliveryDirections: profile.deliveryDirections,
      preferredDriverId: hasPreferred ? preferredDriverId : null,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "DUPLICATE_ACTIVE_REQUEST") {
      return {
        status: "error",
        message: "You already have an active water request.",
      };
    }
    throw err;
  }

  revalidatePath("/resident");
  return { status: "success", message: "Water request submitted." };
}
