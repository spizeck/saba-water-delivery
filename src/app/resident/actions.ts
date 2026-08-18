"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { updateUserProfile } from "@/lib/domain/users";

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
