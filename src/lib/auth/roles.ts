import type { UserRole } from "@/lib/domain/types";

/** Canonical list of application roles. Keep in sync with PRODUCT.md / TECHNICAL.md. */
export const USER_ROLES: readonly UserRole[] = [
  "resident",
  "driver",
  "dispatcher",
  "admin",
];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" && (USER_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Dispatchers and admins share operational access; admins additionally
 * manage drivers, roles, and application settings. This helper centralizes
 * that relationship so it isn't re-derived ad hoc across the app.
 */
export function hasStaffAccess(role: UserRole | null | undefined): boolean {
  return role === "dispatcher" || role === "admin";
}

/**
 * IMPORTANT: This is a UI convenience only. Role values read on the client
 * (e.g. from a Firebase ID token or a client-side profile fetch) must never
 * be trusted for authorization decisions. Real enforcement happens in
 * server-side domain functions and Firestore Security Rules.
 */
