import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import type { WaterRequest } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { getAdminDb } from "@/lib/firebase/admin";

import { sendDeliveryConfirmationEmail } from "./deliveryConfirmationEmail";

export async function notifyDeliveryConfirmation(request: WaterRequest): Promise<void> {
  const db = getAdminDb();
  const claimRef = db.collection("deliveryConfirmationEmailClaims").doc(request.id);

  try {
    await claimRef.create({
      requestId: request.id,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return;
  }

  let status = "skipped";
  let recipient: string | null = null;
  let resendId: string | null = null;
  let error: string | null = null;

  try {
    if (!request.customerId) {
      error = "Unregistered requestor has no authenticated confirmation path.";
    } else {
      const profile = await getUserProfile(request.customerId);
      if (!profile || profile.authStatus !== "claimed") {
        error = "Resident account is not claimed.";
      } else if (!profile.email?.trim()) {
        error = "Registered resident has no email address.";
      } else if (!request.deliveredAt) {
        error = "Request has no delivery timestamp.";
      } else {
        recipient = profile.email.trim();
        const result = await sendDeliveryConfirmationEmail({
          to: recipient,
          displayName: profile.displayName || request.customer?.displayName || "Resident",
          requestId: request.id,
          loads: request.loads,
          gallons: request.gallons,
          village: request.village,
          deliveryDirections: request.deliveryDirections,
          deliveredAt: request.deliveredAt,
        });
        status = result.ok ? "sent" : "failed";
        resendId = result.resendId ?? null;
        error = result.error ?? null;
      }
    }
  } catch (sendError) {
    status = "failed";
    error = sendError instanceof Error ? sendError.message : "Unknown notification error";
  }

  const metadata = { status, recipient, resendId, error };
  try {
    await claimRef.update({ ...metadata, updatedAt: FieldValue.serverTimestamp() });
    await db
      .collection("waterRequests")
      .doc(request.id)
      .collection("events")
      .doc()
      .set({
        type: "delivery_confirmation_email",
        actorId: null,
        actorRole: null,
        createdAt: FieldValue.serverTimestamp(),
        metadata,
      });
  } catch (auditError) {
    console.error("[delivery-confirmation-email] could not record notification result", auditError);
  }
}
