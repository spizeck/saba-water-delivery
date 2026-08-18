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
   * Hours after a delivery is marked `delivered` before it is considered
   * `delivered_unconfirmed` if the resident has not responded.
   */
  deliveryConfirmationWindowHours: 48,

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
   * IANA timezone used to define the "local day" boundary for counting a
   * driver's daily declines (see TECHNICAL.md "Dispatch Offers"). Saba is
   * part of the Caribbean Netherlands; America/Kralendijk observes a fixed
   * UTC-4 offset year-round (no daylight saving), so decline counts reset
   * at a consistent, intuitive local time regardless of server timezone.
   */
  operationalTimezone: "America/Kralendijk",
} as const;

export type AppConfig = typeof appConfig;
