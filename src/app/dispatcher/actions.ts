"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { generateContinuityReportData } from "@/lib/domain/continuityReport";
import { closeDeliveryRun, createDispatchBatch } from "@/lib/domain/dispatchBatches";
import { MAX_BATCH_SIZE } from "@/lib/domain/dispatchBatchSelection";
import {
  getDriverByLinkedUserId,
  reconcileActiveRequest,
  restrictDriver as restrictDriverEntry,
  restoreDriver as restoreDriverEntry,
} from "@/lib/domain/driverRegistry";
import {
  createAccountInvitation,
  getEmailAccountStatus,
  type AccountInvitationResult,
  type EmailAccountStatus,
} from "@/lib/domain/identity";
import { parseRequestedLoads } from "@/lib/domain/quantity";
import { isValidDispatchPriority } from "@/lib/domain/priority";
import type { DispatchPriority } from "@/lib/domain/types";
import {
  cancelWaterRequest,
  changeRequestPriority,
  confirmDeliveryByStaff,
  createWaterRequest,
  dispatcherAssign,
  dispatcherReassign,
  editWaterRequest,
  escalateDispatchRequest,
  findActiveRequestsByPhone,
  getActiveRequestForCustomer,
  getFrequentRequestCountForCustomer,
  markWaterDeliveredByStaff,
  recordWaterCollection,
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

// ---------------------------------------------------------------------------
// Edit request
// ---------------------------------------------------------------------------

export async function editRequest(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };

  const loadsRaw = formData.get("loads");
  const villageRaw = formData.get("village");
  const directionsRaw = formData.get("deliveryDirections");

  const loads = loadsRaw != null ? parseRequestedLoads(loadsRaw) : null;
  const village = villageRaw != null ? String(villageRaw).trim() || null : null;
  const deliveryDirections = directionsRaw != null ? String(directionsRaw).trim() || null : null;

  try {
    await editWaterRequest({
      requestId,
      actorId: session.uid,
      loads,
      village,
      deliveryDirections,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_EDITABLE":
          return { status: "error", message: "This request can no longer be edited. It has already been claimed or further along." };
        case "INVALID_LOADS":
          return { status: "error", message: "Please select a valid quantity (1 or 2 loads)." };
        case "INVALID_VILLAGE":
          return { status: "error", message: "Please select a valid village from the list." };
        case "DIRECTIONS_REQUIRED":
          return { status: "error", message: "Delivery directions are required." };
        case "QUANTITY_LOCKED_BY_COLLECTION":
          return { status: "error", message: "Quantity cannot be changed because water collection has already been recorded for this request." };
        case "NO_CHANGES":
          return { status: "error", message: "No changes were made." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  revalidatePath(`/dispatcher/${requestId}`);
  return { status: "success", message: "Request updated." };
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

  // Reconcile stale activeRequestId before attempting assignment so an
  // orphaned lock from a deleted/completed request does not block the
  // dispatcher.
  const driverEntry = await getDriverByLinkedUserId(driverId);
  if (driverEntry) await reconcileActiveRequest(driverEntry.id);

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

  // Reconcile stale activeRequestId on the new driver before reassignment.
  const newDriverEntry = await getDriverByLinkedUserId(newDriverId);
  if (newDriverEntry) await reconcileActiveRequest(newDriverEntry.id);

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
  status: "idle" | "success" | "error" | "duplicate_warning" | "invitation_warning";
  message?: string;
  duplicates?: DuplicateMatch[];
  invitation?: AccountInvitationResult;
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
  const loads = parseRequestedLoads(formData.get("loads"));
  const village = String(formData.get("village") ?? "").trim();
  const deliveryDirections = String(formData.get("deliveryDirections") ?? "").trim();
  const preferredDriverIdRaw = String(formData.get("preferredDriverId") ?? "").trim();
  const preferredDriverId =
    preferredDriverIdRaw && preferredDriverIdRaw !== "none" ? preferredDriverIdRaw : null;
  const overrideDuplicate = formData.get("overrideDuplicate") === "true";
  const attestationAccepted = formData.get("attestationAccepted") === "true";
  const linkedResidentUid = String(formData.get("linkedResidentUid") ?? "").trim() || null;
  const sendAccountInvitation = formData.get("sendAccountInvitation") === "true";

  if (loads === null) {
    return { status: "error", message: "Please select a valid quantity (1 or 2 loads)." };
  }
  if (!village) return { status: "error", message: "Village/area is required." };
  if (!deliveryDirections) {
    return { status: "error", message: "Delivery directions are required." };
  }

  // Staff take the same "Your Water Situation" questions as the resident
  // form. The storage-capacity field is free-form text.
  const waterSituation = parseWaterSituationFromFormData(formData);

  // --- Existing registered resident path ---
  // Either the dispatcher explicitly chose "Existing resident" and
  // selected someone, or they chose "New / unregistered" but the email
  // matched an existing account and they decided to use it.
  const effectiveResidentUid =
    customerType === "existing" ? String(formData.get("residentUid") ?? "").trim() : linkedResidentUid;

  if (effectiveResidentUid) {
    try {
      await createWaterRequest({
        customerId: effectiveResidentUid,
        loads,
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
        if (err.message === "INVALID_LOADS") {
          return { status: "error", message: "Please select a valid quantity (1 or 2 loads)." };
        }
        if (err.message === "INVALID_VILLAGE") {
          return { status: "error", message: "Please select a valid village from the list." };
        }
        if (err.message === "DUPLICATE_ACTIVE_REQUEST") {
          const existing = await getActiveRequestForCustomer(effectiveResidentUid);
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

  if (customerType === "existing") {
    return { status: "error", message: "Select an existing resident." };
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
      loads,
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
        case "INVALID_LOADS":
          return { status: "error", message: "Please select a valid quantity (1 or 2 loads)." };
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

  // Optional account invitation. This never blocks the water request:
  // if the email send fails, the request is still valid and the dispatcher
  // is warned.
  let invitation: AccountInvitationResult | undefined;
  if (sendAccountInvitation && customerEmail) {
    try {
      invitation = await createAccountInvitation(customerEmail, customerName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send account setup email.";
      invitation = {
        created: false,
        uid: null,
        emailSent: false,
        emailError: message,
      };
    }
  }

  revalidatePath("/dispatcher");

  if (invitation && !invitation.emailSent) {
    return {
      status: "invitation_warning",
      message: "Water request created. Account setup email could not be sent.",
      invitation,
    };
  }

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
            message: `A delivery run can include at most ${MAX_BATCH_SIZE} requests. Split this into more than one run.`,
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
        case "LOADS_NOT_COLLECTED":
          return { status: "error", message: "All physical loads must be recorded as collected before marking delivered. Record the missing load collections first." };
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
 * Close/cancel an orphaned or completed delivery run that is
 * incorrectly still marked active. Only succeeds when no member
 * requests are still "claimed" — the dispatcher must individually
 * resolve those first.
 */
export async function closeRun(
  _prevState: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireStaff();
  const batchId = String(formData.get("batchId") ?? "").trim();
  if (!batchId) return { status: "error", message: "Missing run ID." };

  const result = await closeDeliveryRun(batchId, session.uid);
  if (!result.ok) {
    return { status: "error", message: result.reason };
  }

  revalidatePath("/dispatcher/batches");
  revalidatePath(`/dispatcher/batches/${batchId}`);
  revalidatePath("/dispatcher");
  return { status: "success", message: "Delivery run closed." };
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
        case "LOADS_NOT_COLLECTED":
          return { status: "error", message: "All physical loads must be recorded as collected before marking delivered. Use the Water Collection section to record missing loads." };
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

export async function getFrequentRequestCount(input: {
  customerId?: string | null;
  phone?: string | null;
}): Promise<{ count: number }> {
  await requireStaff();
  const customerId = input.customerId ?? null;
  const phone = input.phone?.trim() ?? null;
  const count = await getFrequentRequestCountForCustomer(customerId, phone);
  return { count };
}

// ---------------------------------------------------------------------------
// Optional account creation from dispatcher request flow
// ---------------------------------------------------------------------------

export type { EmailAccountStatus };

export async function checkEmailAccountStatus(email: string): Promise<EmailAccountStatus> {
  await requireStaff();
  return getEmailAccountStatus(email);
}

export interface SendInvitationActionState {
  status: "idle" | "success" | "error";
  message?: string;
  result?: AccountInvitationResult;
}

export async function sendAccountSetupInvitation(
  _prevState: SendInvitationActionState,
  formData: FormData,
): Promise<SendInvitationActionState> {
  await requireStaff();

  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!email) return { status: "error", message: "Email is required to send an invitation." };

  try {
    const result = await createAccountInvitation(email, displayName);
    if (result.created && result.emailSent) {
      return {
        status: "success",
        message: "Account setup invitation sent.",
        result,
      };
    }
    if (!result.created && result.uid) {
      return {
        status: "error",
        message: "An account already exists for this email. Use that existing account instead.",
        result,
      };
    }
    return {
      status: "error",
      message: result.emailError ?? "Invitation could not be sent.",
      result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send invitation.";
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Staff water collection recording (reconciliation)
// ---------------------------------------------------------------------------

export interface StaffCollectionActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Allows dispatcher/admin to record water collection on behalf of a driver
 * who could not record it themselves (e.g. paper batch reconciliation).
 */
export async function recordCollectionByStaff(
  _prevState: StaffCollectionActionState,
  formData: FormData,
): Promise<StaffCollectionActionState> {
  const session = await requireStaff();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const loadNumberRaw = Number(formData.get("loadNumber"));
  const fillStationId = String(formData.get("fillStationId") ?? "").trim();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!requestId) return { status: "error", message: "Missing request ID." };
  if (loadNumberRaw !== 1 && loadNumberRaw !== 2) {
    return { status: "error", message: "Invalid load number." };
  }
  if (!fillStationId) return { status: "error", message: "Please select a fill station." };
  if (!driverId) return { status: "error", message: "Missing driver ID." };
  if (!note) return { status: "error", message: "A note is required when recording on behalf of a driver." };

  try {
    await recordWaterCollection({
      requestId,
      loadNumber: loadNumberRaw as 1 | 2,
      fillStationId,
      driverId,
      actorId: session.uid,
      actorRole: session.profile.roles.includes("admin") ? "admin" : "dispatcher",
      note,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      switch (err.message) {
        case "REQUEST_NOT_FOUND":
          return { status: "error", message: "Request not found." };
        case "REQUEST_NOT_CLAIMABLE":
          return { status: "error", message: "This request is not in a deliverable state." };
        case "INVALID_LOAD_NUMBER":
          return { status: "error", message: "Invalid load number for this request." };
        case "LOAD_ALREADY_COLLECTED":
          return { status: "error", message: "This load has already been recorded as collected." };
        case "NO_METER_ASSIGNMENT":
          return { status: "error", message: "No meter is assigned to this driver for the selected fill station." };
        case "FILL_STATION_NOT_FOUND":
          return { status: "error", message: "Fill station not found." };
        case "FILL_STATION_INACTIVE":
          return { status: "error", message: "This fill station is no longer active." };
        case "DRIVER_NOT_FOUND":
          return { status: "error", message: "Driver registry entry not found." };
        case "STAFF_NOTE_REQUIRED":
          return { status: "error", message: "A note is required when recording on behalf of a driver." };
        default:
          throw err;
      }
    }
    throw err;
  }

  revalidatePath("/dispatcher");
  revalidatePath(`/dispatcher/${requestId}`);
  return { status: "success", message: "Water collection recorded on behalf of driver." };
}
