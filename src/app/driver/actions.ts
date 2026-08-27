"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { acceptDriverOffer, declineDriverOffer } from "@/lib/domain/dispatch";
import { reconcileActiveRequestByUserId, setAvailabilityByLinkedUser } from "@/lib/domain/driverRegistry";
import { markWaterDelivered, recordWaterCollection } from "@/lib/domain/waterRequests";
import type { DriverAvailabilityStatus } from "@/lib/domain/types";
import { formatSabaTime } from "@/lib/utils/datetime";

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

  try {
    await setAvailabilityByLinkedUser({
      userId: session.uid,
      availabilityStatus: newStatus,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "DRIVER_INELIGIBLE":
          return { status: "error", message: "You are not currently eligible to go online." };
        case "DRIVER_IN_COOLDOWN":
          return {
            status: "error",
            message: "You are in a decline cooldown. Try again once it expires.",
          };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver profile not found. Contact the water office." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/driver");
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Dispatch offer: accept / decline
// ---------------------------------------------------------------------------

export interface OfferActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function acceptOffer(
  _prevState: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const session = await requireRole("driver");
  const offerId = String(formData.get("offerId") ?? "").trim();

  if (!offerId) {
    return { status: "error", message: "Missing offer ID." };
  }

  // Reconcile stale activeRequestId before attempting the claim so a
  // deleted/completed request does not permanently block this driver.
  await reconcileActiveRequestByUserId(session.uid);

  try {
    await acceptDriverOffer({ offerId, driverId: session.uid });
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
          return { status: "error", message: "This request is no longer available. Refresh for a new offer." };
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "DRIVER_INELIGIBLE":
          return { status: "error", message: "You are not currently eligible to claim requests." };
        case "DRIVER_OFFLINE":
          return { status: "error", message: "You must be online to claim requests." };
        case "DRIVER_HAS_ACTIVE_DELIVERY":
          return {
            status: "error",
            message: "Complete your current delivery before accepting another.",
          };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver profile not found." };
        case "OFFER_NOT_FOUND":
          return { status: "error", message: "This offer is no longer valid. Refresh for a new offer." };
        case "OFFER_ALREADY_RESOLVED":
          return { status: "error", message: "This offer was already responded to." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/driver");
  return { status: "success", message: "Delivery accepted!" };
}

export async function declineOffer(
  _prevState: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const session = await requireRole("driver");
  const offerId = String(formData.get("offerId") ?? "").trim();

  if (!offerId) {
    return { status: "error", message: "Missing offer ID." };
  }

  try {
    const result = await declineDriverOffer({ offerId, driverId: session.uid });
    revalidatePath("/driver");
    if (result.enteredCooldown && result.cooldownUntil) {
      const until = formatSabaTime(result.cooldownUntil);
      return {
        status: "success",
        message: `You've reached today's decline limit. New offers paused until ${until}.`,
      };
    }
    return { status: "success", message: "Offer declined." };
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "OFFER_NOT_FOUND":
          return { status: "error", message: "This offer is no longer valid. Refresh for a new offer." };
        case "OFFER_ALREADY_RESOLVED":
          return { status: "error", message: "This offer was already responded to." };
        default:
          throw err;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Mark delivered
// ---------------------------------------------------------------------------

export interface MarkDeliveredActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function markDelivered(
  _prevState: MarkDeliveredActionState,
  formData: FormData,
): Promise<MarkDeliveredActionState> {
  const session = await requireRole("driver");
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) {
    return { status: "error", message: "Missing request ID." };
  }

  try {
    await markWaterDelivered({
      requestId,
      driverId: session.uid,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is not in a deliverable state." };
        case "NOT_ASSIGNED_DRIVER":
          return { status: "error", message: "You are not assigned to this delivery." };
        case "LOADS_NOT_COLLECTED":
          return { status: "error", message: "Record water collection for all loads before marking delivered." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/driver");
  return { status: "success", message: "Delivery marked as complete." };
}

// ---------------------------------------------------------------------------
// Record water collection
// ---------------------------------------------------------------------------

export interface RecordCollectionActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function recordCollection(
  _prevState: RecordCollectionActionState,
  formData: FormData,
): Promise<RecordCollectionActionState> {
  const session = await requireRole("driver");
  const requestId = String(formData.get("requestId") ?? "").trim();
  const loadNumberRaw = Number(formData.get("loadNumber"));
  const fillStationId = String(formData.get("fillStationId") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (loadNumberRaw !== 1 && loadNumberRaw !== 2) {
    return { status: "error", message: "Invalid load number." };
  }
  if (!fillStationId) return { status: "error", message: "Please select a fill station." };

  try {
    await recordWaterCollection({
      requestId,
      loadNumber: loadNumberRaw as 1 | 2,
      fillStationId,
      driverId: session.uid,
      actorId: session.uid,
      actorRole: "driver",
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is not in a deliverable state." };
        case "NOT_ASSIGNED_DRIVER":
          return { status: "error", message: "You are not assigned to this delivery." };
        case "INVALID_LOAD_NUMBER":
          return { status: "error", message: "Invalid load number for this request." };
        case "LOAD_ALREADY_COLLECTED":
          return { status: "error", message: "This load has already been recorded as collected." };
        case "NO_METER_ASSIGNMENT":
          return {
            status: "error",
            message: "No meter is assigned to you for this fill station. Contact the Water Delivery Office.",
          };
        case "FILL_STATION_NOT_FOUND":
          return { status: "error", message: "Fill station not found." };
        case "FILL_STATION_INACTIVE":
          return { status: "error", message: "This fill station is no longer active." };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver profile not found. Contact the water office." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/driver");
  return { status: "success", message: "Water collection recorded." };
}
