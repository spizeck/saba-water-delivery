/**
 * Pure decision logic for the resident delivery-profile confirmation
 * reminder — see PRODUCT.md / TECHNICAL.md "Delivery Profile
 * Confirmation Reminder". No Firestore access, no `server-only` guard,
 * so it can be unit tested directly (same pattern as
 * `dispatchSelection.ts` / `continuityReportData.ts`).
 *
 * Purpose: reduce failed deliveries caused by outdated phone numbers,
 * villages, or delivery directions — NOT a login-frequency nag. The
 * reminder is driven entirely by whether the resident's delivery
 * information is complete and whether it has been meaningfully
 * reviewed recently (a fresh confirmation, a fresh delivery-relevant
 * profile edit, or a recently completed delivery) — never by last
 * login, account age alone, or login count.
 */

import { appConfig } from "./config";
import { isValidSabaVillage } from "./villages";

export type DeliveryProfileRequiredField = "phone" | "village" | "deliveryDirections";

export interface DeliveryProfileReminderInput {
  phone: string | null;
  village: string | null;
  deliveryDirections: string | null;
  /** `UserProfile.deliveryProfileConfirmedAt` — ISO timestamp, or null if never confirmed. */
  deliveryProfileConfirmedAt: string | null;
  /**
   * `confirmedAt` of the resident's most recent request that reached
   * `"confirmed"` status (including auto-confirmed deliveries) — ISO
   * timestamp, or null if the resident has never had a completed
   * delivery. See "What Counts as a Completed Delivery" in
   * PRODUCT.md/TECHNICAL.md.
   */
  lastConfirmedDeliveryAt: string | null;
  /** Defaults to `new Date()` — injectable for deterministic tests. */
  now?: Date;
}

export interface DeliveryProfileReminderResult {
  /** Whether the reminder modal should be shown at all. */
  show: boolean;
  /**
   * True when required delivery information is missing or invalid. The
   * resident must review their profile — "Everything Is Correct" must not
   * be offered, and casual dismissal should be avoided.
   */
  mandatory: boolean;
  /** Which required fields are currently missing/blank, if any. */
  missingFields: DeliveryProfileRequiredField[];
  /**
   * Which required fields are present but invalid (e.g. a noncanonical
   * village). These need an update rather than simple entry.
   */
  invalidFields: DeliveryProfileRequiredField[];
}

function isBlank(value: string | null): boolean {
  return !value || !value.trim();
}

/** Required delivery-profile fields for this reminder — reuses the
 * existing canonical `UserProfile` fields; no duplicate fields. */
function findMissingFields(input: DeliveryProfileReminderInput): DeliveryProfileRequiredField[] {
  const missing: DeliveryProfileRequiredField[] = [];
  if (isBlank(input.phone)) missing.push("phone");
  if (isBlank(input.village)) missing.push("village");
  if (isBlank(input.deliveryDirections)) missing.push("deliveryDirections");
  return missing;
}

function findInvalidFields(input: DeliveryProfileReminderInput): DeliveryProfileRequiredField[] {
  const invalid: DeliveryProfileRequiredField[] = [];
  if (!isBlank(input.village) && !isValidSabaVillage(input.village)) {
    invalid.push("village");
  }
  return invalid;
}

/**
 * Decides whether the delivery-profile confirmation reminder should be
 * shown on the Resident portal, per PRODUCT.md "Delivery Profile
 * Confirmation Reminder":
 *
 * 1. If required fields (phone, village, delivery directions) are
 *    missing, the reminder is always shown and mandatory — the resident
 *    must complete their profile; there is no "Everything Is Correct"
 *    option for incomplete information.
 * 2. Otherwise, compute the most recent MEANINGFUL verification as the
 *    later of `deliveryProfileConfirmedAt` and `lastConfirmedDeliveryAt`
 *    (a completed delivery is itself strong evidence the information
 *    was current and usable). If neither exists, the resident has never
 *    been meaningfully verified and the reminder is shown (first
 *    Resident portal visit).
 * 3. If that most-recent date is at least
 *    `appConfig.deliveryProfileReminderWindowDays` days old, the
 *    reminder is shown (non-mandatory — the resident may dismiss it by
 *    confirming or by reviewing/saving their information).
 */
export function evaluateDeliveryProfileReminder(
  input: DeliveryProfileReminderInput,
): DeliveryProfileReminderResult {
  const missingFields = findMissingFields(input);
  const invalidFields = findInvalidFields(input);
  if (missingFields.length > 0 || invalidFields.length > 0) {
    return { show: true, mandatory: true, missingFields, invalidFields };
  }

  const now = input.now ?? new Date();
  const confirmedAtMs = input.deliveryProfileConfirmedAt
    ? new Date(input.deliveryProfileConfirmedAt).getTime()
    : null;
  const lastDeliveryMs = input.lastConfirmedDeliveryAt
    ? new Date(input.lastConfirmedDeliveryAt).getTime()
    : null;

  // Never verified at all (never confirmed AND never had a completed
  // delivery) — show on first Resident portal visit.
  if (confirmedAtMs === null && lastDeliveryMs === null) {
    return { show: true, mandatory: false, missingFields: [], invalidFields: [] };
  }

  const lastMeaningfulVerificationMs = Math.max(
    confirmedAtMs ?? -Infinity,
    lastDeliveryMs ?? -Infinity,
  );

  const windowMs = appConfig.deliveryProfileReminderWindowDays * 24 * 60 * 60 * 1000;
  const ageMs = now.getTime() - lastMeaningfulVerificationMs;

  return { show: ageMs >= windowMs, mandatory: false, missingFields: [], invalidFields: [] };
}
