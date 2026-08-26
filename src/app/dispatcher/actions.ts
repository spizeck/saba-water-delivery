"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { generateContinuityReportData } from "@/lib/domain/continuityReport";
import { createDispatchBatch } from "@/lib/domain/dispatchBatches";
import { MAX_BATCH_SIZE } from "@/lib/domain/dispatchBatchSelection";
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
  escalateDispatchRequest,
  findActiveRequestsByPhone,
  getActiveRequestForCustomer,
  markWaterDeliveredByStaff,
  resolveDisputeCompleted,
  resolveDisputeReopened,
} from "@/lib/domain/waterRequests";
import { parseWaterSituationFromFormData } from "@/lib/domain/waterSituationForm";
import { sendContinuityReportEmail } from "@/lib/email/continuityReportEmail";
import { renderContinuityReportPdf } from "@/lib/reports/continuityReportPdf";

/** Shared, user-facing messages for water-situation validation errors. */
const WATER_SITUATION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_PERSONS_AFFECTED: "Number of people must be a positive whole number.",
  CRITICAL_EXPLANATION_REQUIRED: "Please explain why this request is critical.",
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
        case "DRIVER_HAS_ACTIVE_DELIVERY":
          return {
            status: "error",
            message: "Selected driver already has an active delivery.",
          };
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
        case "DRIVER_HAS_ACTIVE_DELIVERY":
          return {
            status: "error",
            message: "Selected driver already has an active delivery.",
          };
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
        if (err.message === "INVALID_VILLAGE") {
          return { status: "error", message: "Please select a valid village from the list." };
        }
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
        case "INVALID_VILLAGE":
          return { status: "error", message: "Please select a valid village from the list." };
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

// ---------------------------------------------------------------------------
// Continuity report — manual "Send Now"
// ---------------------------------------------------------------------------

export interface SendContinuityReportState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Staff-only "Send Continuity Report Now" — immediately emails the
 * current continuity snapshot using the exact same report-generation,
 * PDF-rendering, and email-sending functions as the nightly cron job
 * (`src/app/api/cron/continuity-report/route.ts`) and the manual
 * download route — no duplicate report logic. Distinct from "Generate
 * Continuity Report," which only downloads the PDF and never emails
 * anything. See PRODUCT.md / TECHNICAL.md "Operational Continuity
 * Snapshot".
 */
export async function sendContinuityReportNow(
  _prevState: SendContinuityReportState,
  _formData: FormData,
): Promise<SendContinuityReportState> {
  await requireStaff();

  const data = await generateContinuityReportData();
  const pdfBuffer = await renderContinuityReportPdf(data);
  const result = await sendContinuityReportEmail(pdfBuffer, data);

  if (!result.ok) {
    console.error("[continuity-report] manual send failed:", result.error);
    return {
      status: "error",
      message: result.error ?? "Failed to send the continuity report email.",
    };
  }

  return {
    status: "success",
    message: `Continuity report sent (${data.unassigned.length} unassigned, ${data.assigned.length} assigned).`,
  };
}

// ---------------------------------------------------------------------------
// Batch Dispatch
// ---------------------------------------------------------------------------

export interface CreateBatchActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Creates a Batch Dispatch run (see PRODUCT.md / TECHNICAL.md "Batch
 * Dispatch") — a deliberate, dispatcher-controlled exception to the
 * normal one-offer-at-a-time driver dispatch model, used to preassign
 * several loads to one driver at once (e.g. for a driver whose phone/
 * data access is unreliable). On success, redirects straight to the
 * new batch's detail page so staff can immediately download/print its
 * run sheet.
 */
export async function createBatch(
  _prevState: CreateBatchActionState,
  formData: FormData,
): Promise<CreateBatchActionState> {
  const session = await requireStaff();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const requestIds = formData.getAll("requestIds").map((v) => String(v)).filter(Boolean);
  const acknowledgedPreferredOverrideRequestIds = formData
    .getAll("acknowledgedOverrideRequestIds")
    .map((v) => String(v));

  if (!driverId) return { status: "error", message: "Select a driver." };
  if (requestIds.length === 0) {
    return { status: "error", message: "Select at least one request for this batch." };
  }

  let batchId: string;
  try {
    const { batch } = await createDispatchBatch({
      driverId,
      requestIds,
      actorId: session.uid,
      acknowledgedPreferredOverrideRequestIds,
    });
    batchId = batch.id;
  } catch (err: unknown) {
    if (err instanceof Error) {
      const [code] = err.message.split(":");
      switch (code) {
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver not found." };
        case "DRIVER_INELIGIBLE":
          return { status: "error", message: "Selected driver is not eligible." };
        case "NO_REQUESTS_SELECTED":
          return { status: "error", message: "Select at least one request for this batch." };
        case "TOO_MANY_REQUESTS":
          return {
            status: "error",
            message: `A batch can include at most ${MAX_BATCH_SIZE} loads. Split this into more than one batch.`,
          };
        case "DUPLICATE_REQUEST_ID":
        case "REQUEST_NOT_FOUND":
        case "REQUEST_NOT_ELIGIBLE":
          return {
            status: "error",
            message:
              "One or more selected requests changed or are no longer available. Please review the list and try again.",
          };
        case "PREFERRED_DRIVER_OVERRIDE_NOT_ACKNOWLEDGED":
          return {
            status: "error",
            message:
              "One or more selected requests are held for a different resident-preferred driver. Acknowledge the override before confirming.",
          };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  revalidatePath("/dispatcher/batches");
  redirect(`/dispatcher/batches/${batchId}`);
}

/**
 * Staff-only paper-reconciliation delivery record for a batch-assigned
 * load whose driver could not (or did not) mark it delivered through
 * the driver portal — see PRODUCT.md "Batch Dispatch" and
 * docs/INCIDENT_RECOVERY.md. Deliberately scoped server-side to
 * batch-assigned requests only (`recordBatchDeliveryByStaff` throws
 * `NOT_BATCH_ASSIGNED` for anything else) — this is not a general
 * "staff can mark any delivery delivered" shortcut.
 */
export async function recordBatchDelivery(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const batchId = String(formData.get("batchId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!note) return { status: "error", message: "A short verification note is required." };

  try {
    await markWaterDeliveredByStaff({ requestId, actorId: session.uid, note });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is not in a deliverable state." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher/batches");
  revalidatePath("/dispatcher");
  if (batchId) revalidatePath(`/dispatcher/batches/${batchId}`);
  revalidatePath(`/dispatcher/${requestId}`);
  return { status: "success", message: "Delivery recorded." };
}

/**
 * Staff "Mark Delivered" for a normal (non-batch) request. Use this
 * when a driver cannot use the app, a delivery is reported by phone/
 * radio, or staff are reconciling a paper run. Requires a short note
 * and only works for requests currently in `claimed` status.
 */
export async function markDeliveredByStaff(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!note) return { status: "error", message: "A short verification note is required." };

  try {
    await markWaterDeliveredByStaff({ requestId, actorId: session.uid, note });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is not in a deliverable state." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  revalidatePath(`/dispatcher/${requestId}`);
  return { status: "success", message: "Delivery recorded." };
}

export async function escalateRequest(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (!reason) return { status: "error", message: "A reason is required." };

  try {
    await escalateDispatchRequest({ requestId, actorId: session.uid, reason });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_ESCALATABLE":
          return { status: "error", message: "This request cannot be escalated." };
        case "ESCALATE_REASON_REQUIRED":
          return { status: "error", message: "A reason is required." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  revalidatePath(`/dispatcher/${requestId}`);
  return { status: "success", message: "Request escalated. It now appears ahead in the dispatch queue." };
}
