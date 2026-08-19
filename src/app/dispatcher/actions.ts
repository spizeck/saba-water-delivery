"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { restrictDriver as restrictDriverEntry, restoreDriver as restoreDriverEntry } from "@/lib/domain/driverRegistry";
import { isValidDispatchPriority } from "@/lib/domain/priority";
import type { DispatchPriority } from "@/lib/domain/types";
import {
  cancelWaterRequest,
  changeRequestPriority,
  confirmDeliveryByStaff,
  createWaterRequest,
  dispatcherAssign,
  dispatcherReassign,
  findActiveRequestsByPhone,
  getActiveRequestForCustomer,
  resolveDisputeCompleted,
  resolveDisputeReopened,
} from "@/lib/domain/waterRequests";
import { parseWaterSituationFromFormData } from "@/lib/domain/waterSituationForm";

/** Shared, user-facing messages for water-situation validation errors. */
const WATER_SITUATION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_PERSONS_AFFECTED: "Number of people must be a positive whole number.",
};

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
    await restrictDriverEntry({ driverId, restrictedBy: session.uid, reason });
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
    await restoreDriverEntry({ driverId, restoredBy: session.uid });
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

// ---------------------------------------------------------------------------
// Dispatcher-created requests
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  id: string;
  village: string;
  requestedAt: string;
  status: string;
}

export interface CreateRequestActionState {
  status: "idle" | "success" | "error" | "duplicate_warning";
  message?: string;
  duplicates?: DuplicateMatch[];
}

/**
 * Creates a water request on behalf of a customer who called or visited
 * the office. Supports both a registered resident (selected from the
 * directory) and an unregistered/manual customer. Both paths call the
 * same `createWaterRequest()` used by the resident portal — there is no
 * separate manual queue (see PRODUCT.md "Dispatcher-Created Requests").
 */
export async function createManualRequest(
  _prevState: CreateRequestActionState,
  formData: FormData,
): Promise<CreateRequestActionState> {
  const session = await requireStaff();

  const customerType = String(formData.get("customerType") ?? "existing");
  const village = String(formData.get("village") ?? "").trim();
  const deliveryDirections = String(formData.get("deliveryDirections") ?? "").trim();
  const preferredDriverIdRaw = String(formData.get("preferredDriverId") ?? "").trim();
  const preferredDriverId =
    preferredDriverIdRaw && preferredDriverIdRaw !== "none" ? preferredDriverIdRaw : null;
  const overrideDuplicate = formData.get("overrideDuplicate") === "true";
  const attestationAccepted = formData.get("attestationAccepted") === "true";

  if (!village) return { status: "error", message: "Village/area is required." };
  if (!deliveryDirections) {
    return { status: "error", message: "Delivery directions are required." };
  }

  // Staff take the same "Your Water Situation" questions as the resident
  // form. The storage-capacity field is free-form text.
  const waterSituation = parseWaterSituationFromFormData(formData);

  if (customerType === "existing") {
    const residentUid = String(formData.get("residentUid") ?? "").trim();
    if (!residentUid) {
      return { status: "error", message: "Select an existing resident." };
    }

    try {
      await createWaterRequest({
        customerId: residentUid,
        village,
        deliveryDirections,
        preferredDriverId,
        source: "dispatcher",
        createdBy: session.uid,
        waterSituation,
        attestationAccepted,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "DUPLICATE_ACTIVE_REQUEST") {
          const existing = await getActiveRequestForCustomer(residentUid);
          return {
            status: "error",
            message: existing
              ? `This resident already has an active request (status: ${existing.status}). Resolve it before creating a new one.`
              : "This resident already has an active request.",
          };
        }
        if (err.message === "ATTESTATION_REQUIRED") {
          return {
            status: "error",
            message: "You must confirm the attestation before creating the request.",
          };
        }
        const situationMessage = WATER_SITUATION_ERROR_MESSAGES[err.message];
        if (situationMessage) {
          return { status: "error", message: situationMessage };
        }
      }
      throw err;
    }

    revalidatePath("/dispatcher");
    return { status: "success", message: "Water request created." };
  }

  // --- Unregistered / manual customer ---
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();
  const customerEmail = String(formData.get("customerEmail") ?? "").trim();

  if (!customerName) return { status: "error", message: "Customer name is required." };
  if (!customerPhone) return { status: "error", message: "Phone number is required." };

  // Soft duplicate check: phone-number matching is not reliable identity
  // verification, so this is a warning staff can deliberately override,
  // never a silent block (see PRODUCT.md "Duplicate Requests").
  const possibleMatches = await findActiveRequestsByPhone(customerPhone);
  if (possibleMatches.length > 0 && !overrideDuplicate) {
    return {
      status: "duplicate_warning",
      message: "A request with this phone number is already active.",
      duplicates: possibleMatches.map((m) => ({
        id: m.id,
        village: m.village,
        requestedAt: m.requestedAt,
        status: m.status,
      })),
    };
  }

  try {
    await createWaterRequest({
      customerId: null,
      village,
      deliveryDirections,
      preferredDriverId,
      source: "dispatcher",
      createdBy: session.uid,
      customer: {
        displayName: customerName,
        phone: customerPhone,
        email: customerEmail || null,
      },
      overrideMatchedRequestIds: overrideDuplicate
        ? possibleMatches.map((m) => m.id)
        : undefined,
      waterSituation,
      attestationAccepted,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "CUSTOMER_NAME_REQUIRED":
          return { status: "error", message: "Customer name is required." };
        case "CUSTOMER_PHONE_REQUIRED":
          return { status: "error", message: "Phone number is required." };
        case "ATTESTATION_REQUIRED":
          return {
            status: "error",
            message: "You must confirm the attestation before creating the request.",
          };
        default: {
          const situationMessage = WATER_SITUATION_ERROR_MESSAGES[err.message];
          if (situationMessage) {
            return { status: "error", message: situationMessage };
          }
          throw err;
        }
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Water request created." };
}

// ---------------------------------------------------------------------------
// Staff confirmation for unregistered customers
// ---------------------------------------------------------------------------

export async function confirmUnregisteredDelivery(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };

  try {
    await confirmDeliveryByStaff({ requestId, actorId: session.uid });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_HAS_REGISTERED_CUSTOMER":
          return {
            status: "error",
            message: "This request has a registered customer and must be confirmed through the normal resident workflow.",
          };
        case "INVALID_STATUS_FOR_CONFIRM":
          return { status: "error", message: "This delivery cannot be confirmed right now." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Delivery confirmed on behalf of the customer." };
}

// ---------------------------------------------------------------------------
// Dispatcher priority override
// ---------------------------------------------------------------------------

/**
 * Dispatcher/admin manually overrides a request's dispatch priority.
 * Always requires a reason, which is audited (see PRODUCT.md
 * "Dispatcher Priority Review"). Never touches the resident's original
 * reported water-situation answers.
 */
export async function changePriority(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const newPriorityRaw = String(formData.get("newPriority") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!isValidDispatchPriority(newPriorityRaw)) {
    return { status: "error", message: "Select a valid priority." };
  }
  if (!reason) return { status: "error", message: "A reason is required." };

  const newPriority = newPriorityRaw as DispatchPriority;

  try {
    await changeRequestPriority({ requestId, actorId: session.uid, newPriority, reason });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "REQUEST_NOT_FOUND") return { status: "error", message: "Request not found." };
      if (err.message === "PRIORITY_REASON_REQUIRED") return { status: "error", message: "A reason is required." };
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  return { status: "success", message: "Priority updated." };
}
