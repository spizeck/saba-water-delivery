/**
 * Pure, deterministic outbound message templates for the WhatsApp
 * conversation. Kept separate from the conversation reducer so exact
 * wording can be tested/reviewed independently, and so it's obvious at
 * a glance that nothing here calls an LLM or generates free-form text
 * (see DEVIN.md "Do Not Implement AI Chat").
 */

import type { DispatchPriority, WaterRequestStatus } from "@/lib/domain/types";
import { formatWaterQuantity } from "@/lib/domain/quantity";
import { waterOfficeContact } from "@/lib/siteContact";

import { villageMenuText, vulnerableCircumstanceMenuText } from "./parsing";
import type { WhatsAppDriverOption, WhatsAppSessionDraft } from "./types";

export const WELCOME_MENU =
  "Welcome to Saba Water Delivery.\n\n" +
  "What would you like to do?\n\n" +
  "1. Request water\n" +
  "2. Check my current request\n\n" +
  "Reply with 1 or 2.";

export const UNRECOGNIZED_MENU_CHOICE = "Sorry, I didn't understand that. " + WELCOME_MENU;

export const AMBIGUOUS_IDENTITY_MESSAGE =
  "We could not automatically match your WhatsApp number to a single account. " +
  "For your security, please contact the Water Delivery Office or use the website to request water:\n" +
  `WhatsApp: ${waterOfficeContact.whatsappNumber}`;

export const BACKEND_UNAVAILABLE_MESSAGE =
  "Sorry, the water delivery system is temporarily unavailable. " +
  `Please try again shortly, or contact the Water Delivery Office at ${waterOfficeContact.whatsappNumber}.`;

export function confirmProfileMessage(profile: {
  phone: string | null;
  village: string | null;
  deliveryDirections: string | null;
}): string {
  return (
    "Here is the delivery information on file:\n\n" +
    `Phone: ${profile.phone || "Not on file"}\n` +
    `Village: ${profile.village || "Not on file"}\n` +
    `Delivery directions: ${profile.deliveryDirections || "Not on file"}\n\n` +
    "Is this still correct?\n\n" +
    "1. Yes, use this information\n" +
    "2. No, I need to update it\n\n" +
    "Reply with 1 or 2."
  );
}

export const ASK_NAME = "What is your full name?";
export const ASK_VILLAGE = `Which village? Reply with a number:\n\n${villageMenuText()}`;
export const INVALID_VILLAGE = `Sorry, please reply with one of the listed numbers.\n\n${ASK_VILLAGE}`;
export const ASK_DIRECTIONS =
  "Please describe how a driver can find your home (landmarks, gate color, etc.) — a street address is not required.";
export const ASK_PHONE =
  "What phone number should the driver/office use to reach you? Reply with the number, or SKIP to use this WhatsApp number.";

export const ASK_PERSONS_AFFECTED =
  "How many people rely on this water? Reply with a number, or SKIP if you'd rather not say.";
export const INVALID_PERSONS_AFFECTED =
  `Please reply with a positive whole number, or SKIP.\n\n${ASK_PERSONS_AFFECTED}`;

export const ASK_VULNERABLE = `Are there vulnerable persons or critical circumstances?\n\n${vulnerableCircumstanceMenuText()}`;
export const INVALID_VULNERABLE = `Sorry, please reply with the listed numbers.\n\n${ASK_VULNERABLE}`;

export const ASK_STORAGE =
  "About how much water storage/cistern capacity do you have available? Reply in your own words, or SKIP.";

export const ASK_URGENCY = "How urgent is this request?\n\n1. Normal\n2. Critical\n\nReply with 1 or 2.";
export const INVALID_URGENCY = `Sorry, please reply with 1 or 2.\n\n${ASK_URGENCY}`;

export const ASK_LOADS =
  "How much water are you requesting?\n\n" +
  "1. 1 load (1,000 gallons)\n" +
  "2. 2 loads (2,000 gallons)\n\n" +
  "Reply with 1 or 2.";
export const INVALID_LOADS = `Sorry, please reply with 1 or 2.\n\n${ASK_LOADS}`;

export const ASK_CRITICAL_EXPLANATION = "Please briefly explain why this request is critical.";
export const CRITICAL_EXPLANATION_REQUIRED_MESSAGE =
  `A brief explanation is required for a Critical request.\n\n${ASK_CRITICAL_EXPLANATION}`;

export function preferredDriverMenuText(drivers: WhatsAppDriverOption[]): string {
  const lines = drivers.map((d, i) => `${i + 1}. ${d.displayName}`);
  return (
    "Would you like to request a preferred driver? This is a preference only, not a guarantee.\n\n" +
    "0. No preference\n" +
    lines.join("\n") +
    "\n\nReply with a number."
  );
}

export const INVALID_PREFERRED_DRIVER = "Sorry, please reply with one of the listed numbers.";

const URGENCY_LABEL: Record<string, string> = { normal: "Normal", critical: "Critical" };

export function requestSummaryMessage(
  draft: WhatsAppSessionDraft,
  preferredDriverName: string | null,
): string {
  const loads = draft.loads ?? 1;
  const lines = [
    "Please review your request:",
    "",
    `Name: ${draft.displayName ?? ""}`,
    `Village: ${draft.village ?? ""}`,
    `Quantity: ${formatWaterQuantity(loads)}`,
    `Persons affected: ${draft.personsAffected ?? "Not provided"}`,
    `Priority reported: ${URGENCY_LABEL[draft.reportedUrgency ?? "normal"]}`,
    `Preferred driver: ${preferredDriverName ?? "No preference"}`,
    "",
    "By confirming, you state that you are authorized to request water at this location and that the information provided is true and factual.",
    "",
    "Reply CONFIRM to submit or CANCEL to stop.",
  ];
  return lines.join("\n");
}

export const REQUEST_CANCELLED_MESSAGE = "Your request was not submitted. Reply HI to start over.";
export const REQUEST_SUBMITTED_MESSAGE =
  "Thank you. Your water request has been submitted and will be handled the same way as a website request.";

export const DUPLICATE_ACTIVE_REQUEST_MESSAGE =
  "You already have an active water request, so a new one cannot be created. Here is its current status:";

export const NO_ACTIVE_REQUEST_MESSAGE = "You do not have an active water request right now.";

const STATUS_LABEL: Record<WaterRequestStatus, string> = {
  requested: "Submitted, waiting to be opened for drivers",
  preferred_driver_hold: "Waiting for your preferred driver",
  available: "Waiting for a driver",
  claimed: "Driver assigned",
  delivered: "Delivery marked complete, awaiting your confirmation",
  confirmed: "Delivery confirmed — completed",
  disputed: "Delivery disputed — under review",
  cancelled: "Cancelled",
};

const PRIORITY_LABEL: Record<DispatchPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
};

export function requestStatusMessage(
  status: WaterRequestStatus,
  dispatchPriority: DispatchPriority,
): string {
  return `Status: ${STATUS_LABEL[status]}\nPriority: ${PRIORITY_LABEL[dispatchPriority]}`;
}

export function deliveryConfirmationPrompt(loads: number = 1): string {
  return (
    "Your driver marked the delivery complete.\n\n" +
    `Did you receive your ${formatWaterQuantity(loads as 1 | 2).toLowerCase()}?\n\n` +
    "1. Yes, received\n" +
    "2. No, there is a problem\n\n" +
    "Reply with 1 or 2."
  );
}

export const INVALID_DELIVERY_CONFIRMATION_CHOICE =
  "Sorry, please reply with 1 or 2.";

export const ASK_DISPUTE_REASON = "Please briefly describe the problem with your delivery.";

export const DELIVERY_CONFIRMED_MESSAGE = "Thank you — delivery confirmed.";
export const DELIVERY_DISPUTED_MESSAGE =
  "Thank you. The issue has been reported and the Water Delivery Office will review it.";

export const PREFERRED_DRIVER_NO_LONGER_AVAILABLE_MESSAGE =
  "Your selected preferred driver is no longer available for a preference hold, so your request will go to the general driver queue instead. This does not delay your request.";

export const REQUEST_STATE_CHANGED_MESSAGE =
  "Something about your request changed while we were talking. Please reply HI to check your current status.";
