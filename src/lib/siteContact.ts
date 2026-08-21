/**
 * Centralized PUBLIC contact information for the Water Delivery Office.
 *
 * Shown on public-facing pages (homepage "Need Help?" card, Terms of
 * Use, and the Data Deletion instructions page required for Facebook
 * Login / Meta compliance). Centralized here so the same number is
 * never duplicated — and never allowed to drift — across multiple
 * compliance/support pages.
 *
 * This is intentionally separate from `src/lib/domain/config.ts`
 * (internal business/dispatch configuration) — this module holds only
 * public-facing contact details safe to import from any client or
 * server component.
 */
export const waterOfficeContact = {
  whatsappNumber: "+599 416 5363",
  whatsappHref: "https://wa.me/5994165363",
} as const;
