import "server-only";

/**
 * Server-only orchestrator for one inbound WhatsApp message — see
 * PRODUCT.md / TECHNICAL.md "WhatsApp Resident Ordering". This is the
 * ONLY place that wires together: session storage (`session.ts`),
 * resident identity matching (`residentMatch.ts`), the pure
 * conversation reducer (`conversationSteps.ts`), the canonical domain
 * functions (`createWaterRequest`, `confirmWaterDelivery`,
 * `disputeWaterDelivery`, `updateUserProfile` — the EXACT same
 * functions the web app uses, never a parallel implementation), and
 * outbound message delivery (`client.ts`).
 *
 * Called by the webhook route AFTER idempotency has already been
 * claimed for this Meta message ID — this function assumes it is safe
 * to process and never needs to re-check for duplicates itself.
 */

import { getEligibleDriverOptions } from "@/lib/domain/driverRegistry";
import { getUserProfile, updateUserProfile } from "@/lib/domain/users";
import {
  confirmWaterDelivery,
  createWaterRequest,
  disputeWaterDelivery,
  findActiveRequestsByPhone,
  getActiveRequestForCustomer,
} from "@/lib/domain/waterRequests";

import { getWhatsAppClientConfig, sendWhatsAppTextMessage } from "./client";
import { processMessage } from "./conversationSteps";
import * as m from "./messages";
import { matchResidentByPhone } from "./residentMatch";
import { getOrCreateSession, saveSession } from "./session";
import type { WhatsAppConversationContext, WhatsAppSession } from "./types";

/** Resident-friendly translations of canonical domain error codes — never expose raw codes/stack traces (see PRODUCT.md "Error Handling"). */
const ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_ACTIVE_REQUEST: "You already have an active request, so a new one could not be created.",
  CUSTOMER_NAME_REQUIRED: "Please provide your name and try again.",
  CUSTOMER_PHONE_REQUIRED: "Please provide a phone number and try again.",
  ATTESTATION_REQUIRED: "Your request could not be submitted. Please try again.",
  INVALID_PERSONS_AFFECTED: "Please provide a valid number of persons affected.",
  CRITICAL_EXPLANATION_REQUIRED: "A brief explanation is required for a Critical request.",
  REQUEST_NOT_FOUND: m.REQUEST_STATE_CHANGED_MESSAGE,
  NOT_REQUEST_OWNER: m.REQUEST_STATE_CHANGED_MESSAGE,
  INVALID_STATUS_FOR_CONFIRM: m.REQUEST_STATE_CHANGED_MESSAGE,
  INVALID_STATUS_FOR_DISPUTE: m.REQUEST_STATE_CHANGED_MESSAGE,
  DELIVERY_PROFILE_INCOMPLETE: "Please provide complete delivery information.",
  USER_NOT_FOUND: m.BACKEND_UNAVAILABLE_MESSAGE,
};

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof Error && ERROR_MESSAGES[err.message]) return ERROR_MESSAGES[err.message];
  // Never surface raw Firebase errors, stack traces, document IDs, or
  // internal enum names — see PRODUCT.md "Error Handling".
  return m.BACKEND_UNAVAILABLE_MESSAGE;
}

async function buildContext(session: WhatsAppSession): Promise<WhatsAppConversationContext> {
  let registeredProfile: WhatsAppConversationContext["registeredProfile"] = null;
  let activeRequest: WhatsAppConversationContext["activeRequest"] = null;

  if (session.customerType === "registered" && session.customerId) {
    const profile = await getUserProfile(session.customerId);
    if (profile) {
      registeredProfile = {
        displayName: profile.displayName,
        phone: profile.phone,
        village: profile.village,
        deliveryDirections: profile.deliveryDirections,
      };
    }
    activeRequest = await getActiveRequestForCustomer(session.customerId);
  } else if (session.customerType === "unregistered") {
    const matches = await findActiveRequestsByPhone(session.senderPhone);
    activeRequest = matches[0] ?? null;
  }

  // Small, bounded, indexed lookup (linked + eligible drivers only) —
  // cheap enough to fetch unconditionally rather than only on the
  // preferred-driver step, keeping this orchestrator simple (see
  // PRODUCT.md "Webhook Performance").
  const eligibleDrivers = await getEligibleDriverOptions();

  return { now: new Date(), activeRequest, eligibleDrivers, registeredProfile };
}

/**
 * Processes one already-deduplicated inbound WhatsApp text message from
 * `senderPhone` and sends any resulting reply/replies.
 */
export async function handleIncomingWhatsAppMessage(
  senderPhone: string,
  inboundText: string,
): Promise<void> {
  const config = getWhatsAppClientConfig();
  if (!config) {
    console.error("[whatsapp] received a message but WhatsApp is not configured; dropping.");
    return;
  }

  const now = new Date();
  let session = await getOrCreateSession(senderPhone, now);

  // Resolve identity once per conversation (see PRODUCT.md "Resident
  // Identity Strategy") — cached on the session so it isn't repeated
  // for every message in a multi-step conversation.
  if (session.customerType === "unknown") {
    const match = await matchResidentByPhone(senderPhone);
    if (match.type === "unique") {
      session = { ...session, customerId: match.resident.uid, customerType: "registered" };
    } else if (match.type === "ambiguous") {
      session = { ...session, customerType: "ambiguous" };
    } else {
      session = { ...session, customerType: "unregistered" };
    }
  }

  const context = await buildContext(session);
  const result = processMessage(session, inboundText, context);

  const outbound = [...result.outbound];

  for (const action of result.actions ?? []) {
    try {
      switch (action.type) {
        case "create_request":
          await createWaterRequest({
            customerId: action.customerId,
            loads: action.loads,
            village: action.village,
            deliveryDirections: action.deliveryDirections,
            preferredDriverId: action.preferredDriverId,
            source: "whatsapp",
            customer: action.customer,
            waterSituation: action.waterSituation,
            attestationAccepted: true,
          });
          outbound.push(m.REQUEST_SUBMITTED_MESSAGE);
          break;
        case "update_profile":
          await updateUserProfile({
            uid: action.uid,
            displayName: action.displayName,
            phone: action.phone,
            village: action.village,
            deliveryDirections: action.deliveryDirections,
          });
          break;
        case "confirm_delivery":
          await confirmWaterDelivery({ requestId: action.requestId, customerId: action.customerId });
          outbound.push(m.DELIVERY_CONFIRMED_MESSAGE);
          break;
        case "dispute_delivery":
          await disputeWaterDelivery({
            requestId: action.requestId,
            customerId: action.customerId,
            reason: action.reason,
          });
          outbound.push(m.DELIVERY_DISPUTED_MESSAGE);
          break;
      }
    } catch (err) {
      console.error(
        "[whatsapp] action failed:",
        action.type,
        err instanceof Error ? err.message : "unknown error",
      );
      outbound.push(friendlyErrorMessage(err));
      // Stop processing further actions in this batch (e.g. don't
      // create a request if the profile update that was meant to
      // precede it just failed) — the resident sees a clear error and
      // can retry from the current state.
      break;
    }
  }

  if (result.session) {
    await saveSession(result.session, now);
  }

  for (const text of outbound) {
    const sendResult = await sendWhatsAppTextMessage(config, senderPhone, text);
    if (!sendResult.ok) {
      // Never log the access token — only Meta's own error text.
      console.error("[whatsapp] send failed:", sendResult.error);
    }
  }
}
