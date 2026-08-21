/**
 * Centralized business configuration.
 *
 * Values here are the kind of thing an administrator may need to change
 * without a code change to application logic (see TECHNICAL.md and
 * DEVIN.md "Configuration"). Keeping them in one place avoids scattering
 * magic numbers across the codebase.
 *
 * V1 stores these as constants. If/when admins need to change these at
 * runtime, this is the module that should be backed by a Firestore
 * `config/app` document instead of hard-coded values.
 */

export const appConfig = {
  /** Standard load size. Arbitrary quantities are not supported in V1. */
  standardLoadGallons: 1000 as const,

  /**
   * Hours a resident's chosen preferred driver has exclusive access to
   * claim a request before it opens to the general driver queue.
   */
  preferredDriverWindowHours: 24,

  /**
   * Hours a resident has, after a delivery is marked `delivered`, to
   * confirm receipt or report a problem before the delivery is
   * automatically confirmed (see `src/lib/domain/deliveryConfirmation.ts`
   * and PRODUCT.md "Delivery Confirmation"). Automatic confirmation is
   * enforced lazily — the next time the request is read by any
   * operational workflow — not by a precisely-scheduled job. See
   * TECHNICAL.md "Delivery Confirmation Timeout".
   */
  deliveryConfirmationWindowHours: 24,

  /**
   * Default dispatch (single-offer) settings. These are the seed values
   * used the first time an administrator opens dispatch settings, and the
   * fallback used if the `config/dispatchSettings` Firestore document has
   * not been created yet. Once an admin saves settings, the Firestore
   * document (see src/lib/domain/dispatchSettings.ts) becomes the live
   * source of truth — these constants are not read again after that.
   */
  defaultMaxDeclinesPerDay: 3,
  defaultDeclineCooldownHours: 1,

  /**
   * IANA timezone for ALL Saba operational date/time display and
   * calendar-boundary calculations (see TECHNICAL.md "Saba Operational
   * Timezone"). This is the single centralized setting referenced by
   * `src/lib/utils/datetime.ts` — no other module should hard-code a
   * timezone or manually offset a timestamp.
   *
   * America/Puerto_Rico observes a fixed UTC-4 offset year-round (no
   * daylight saving), matching Saba's actual clock. Firestore timestamps
   * are never altered — they remain proper absolute instants; only
   * display formatting and calendar-day/month/year boundaries (e.g. the
   * driver decline-limit "day," statistics month/year periods) use this
   * timezone.
   */
  operationalTimezone: "America/Puerto_Rico",

  /**
   * Days after which the resident delivery-profile confirmation reminder
   * becomes due again, if not refreshed sooner by a fresh profile
   * confirmation, a delivery-relevant profile edit, or a newly confirmed
   * delivery (see PRODUCT.md / TECHNICAL.md "Delivery Profile
   * Confirmation Reminder"). This is a UX safeguard against outdated
   * phone numbers/villages/directions, not a request-blocking rule.
   */
  deliveryProfileReminderWindowDays: 45,

  /**
   * Hours an incomplete WhatsApp ordering conversation
   * (`whatsappSessions/{id}`) remains valid before a new inbound
   * message starts a fresh conversation instead of resuming stale
   * draft data (see PRODUCT.md / TECHNICAL.md "WhatsApp Resident
   * Ordering"). Matches WhatsApp's own 24-hour customer-service
   * messaging window, so "the conversation is still fresh" and "we can
   * still message this person without a template" line up. Enforced
   * lazily on read, like the delivery-confirmation timeout — no
   * scheduled cleanup job for V1 (see DEVIN.md "Do Not Overbuild").
   */
  whatsappSessionExpirationHours: 24,
} as const;

export type AppConfig = typeof appConfig;
