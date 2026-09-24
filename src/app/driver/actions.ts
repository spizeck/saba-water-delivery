"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { releaseAssignedDelivery } from "@/lib/domain/dispatch";
import { setAvailabilityByLinkedUser } from "@/lib/domain/driverRegistry";
import {
  markWaterDelivered,
  recordWaterCollection,
} from "@/lib/domain/waterRequests";
import type { DriverAvailabilityStatus } from "@/lib/domain/types";
import { getLogger, serializeError } from "@/lib/logging";
import { getDeclineResultMessage } from "@/lib/utils/declineResult";
import { formatSabaTime } from "@/lib/utils/datetime";

const log = getLogger("driver.actions");

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
  const newStatus = String(
    formData.get("availabilityStatus") ?? "",
  ) as DriverAvailabilityStatus;

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
          return {
            status: "error",
            message: "You are not currently eligible to go online.",
          };
        case "DRIVER_IN_COOLDOWN": {
          const e = err as Error & {
            cooldownUntil?: string;
            isDailyLimit?: boolean;
          };
          if (e.isDailyLimit) {
            return {
              status: "error",
              message:
                "You have reached today’s decline limit and are offline for the rest of the day. You can receive deliveries again tomorrow.",
            };
          }
          const until = e.cooldownUntil
            ? formatSabaTime(e.cooldownUntil)
            : "later";
          return {
            status: "error",
            message: `You have reached the decline limit. You are offline until ${until}.`,
          };
        }
        case "DRIVER_NOT_FOUND":
          return {
            status: "error",
            message: "Driver profile not found. Contact the water office.",
          };
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
// Assigned delivery: release
// ---------------------------------------------------------------------------

export interface ReleaseActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function releaseDelivery(
  _prevState: ReleaseActionState,
  formData: FormData,
): Promise<ReleaseActionState> {
  const session = await requireRole("driver");
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) {
    return { status: "error", message: "Missing request ID." };
  }

  try {
    const result = await releaseAssignedDelivery({
      requestId,
      driverId: session.uid,
    });
    revalidatePath("/driver");
    const message = getDeclineResultMessage({
      state: result.availabilityStatus,
      cooldownUntil: result.cooldownUntil
        ? new Date(result.cooldownUntil)
        : null,
    });
    return { status: "success", message };
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_RELEASABLE":
          return {
            status: "error",
            message:
              "This delivery can no longer be released. Refresh the page.",
          };
        case "NOT_ASSIGNED_DRIVER":
          return {
            status: "error",
            message:
              "This delivery is no longer assigned to you. Refresh the page.",
          };
        case "DELIVERY_RUN_MANAGED":
          return {
            status: "error",
            message:
              "This delivery is part of a delivery run. Contact the water office to change it.",
          };
        case "REQUEST_HAS_COLLECTIONS":
          return {
            status: "error",
            message:
              "Water collection has already been recorded for this delivery. Contact the water office to release it.",
          };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver profile not found." };
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
          return {
            status: "error",
            message: "This request is not in a deliverable state.",
          };
        case "NOT_ASSIGNED_DRIVER":
          return {
            status: "error",
            message: "You are not assigned to this delivery.",
          };
        case "LOADS_NOT_COLLECTED":
          return {
            status: "error",
            message:
              "Record water collection for all loads before marking delivered.",
          };
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
  if (!fillStationId)
    return { status: "error", message: "Please select a fill station." };

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
          return {
            status: "error",
            message: "This request is not in a deliverable state.",
          };
        case "NOT_ASSIGNED_DRIVER":
          return {
            status: "error",
            message: "You are not assigned to this delivery.",
          };
        case "INVALID_LOAD_NUMBER":
          return {
            status: "error",
            message: "Invalid load number for this request.",
          };
        case "LOAD_ALREADY_COLLECTED":
          return {
            status: "error",
            message: "This load has already been recorded as collected.",
          };
        case "NO_METER_ASSIGNMENT":
          return {
            status: "error",
            message:
              "No meter is assigned to you for this fill station. Contact the Water Delivery Office.",
          };
        case "FILL_STATION_NOT_FOUND":
          return { status: "error", message: "Fill station not found." };
        case "FILL_STATION_INACTIVE":
          return {
            status: "error",
            message: "This fill station is no longer active.",
          };
        case "DRIVER_NOT_FOUND":
          return {
            status: "error",
            message: "Driver profile not found. Contact the water office.",
          };
        default:
          log.error("driver.record_collection.failed", {
            error: serializeError(err),
          });
          return {
            status: "error",
            message: "Failed to record collection. Please try again.",
          };
      }
    }
    log.error("driver.record_collection.failed", {
      error: serializeError(err),
    });
    return {
      status: "error",
      message: "Failed to record collection. Please try again.",
    };
  }

  revalidatePath("/driver");
  return { status: "success", message: "Water collection recorded." };
}
