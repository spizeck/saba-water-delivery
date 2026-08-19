import type { UserRole } from "@/lib/domain/types";

/** Canonical list of application roles. Keep in sync with PRODUCT.md / TECHNICAL.md. */
export const USER_ROLES: readonly UserRole[] = [
  "resident",
  "driver",
  "dispatcher",
  "admin",
  "viewer",
];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" && (USER_ROLES as readonly string[]).includes(value)
  );
}

/** Normalizes an unknown value into a valid `UserRole[]`. */
export function toUserRoles(value: unknown): UserRole[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).filter(isUserRole);
  }
  return ["resident"];
}

/**
 * Returns true if the user possesses at least one of the specified roles.
 */
export function hasRole(userRoles: UserRole[], required: UserRole | UserRole[]): boolean {
  const allowed = Array.isArray(required) ? required : [required];
  return allowed.some((r) => userRoles.includes(r));
}

/**
 * Dispatchers and admins share operational access; admins additionally
 * manage drivers, roles, and application settings. This helper centralizes
 * that relationship so it isn't re-derived ad hoc across the app.
 */
export function hasStaffAccess(roles: UserRole[]): boolean {
  return roles.includes("dispatcher") || roles.includes("admin");
}

/**
 * `viewer` is deliberately NOT part of `hasStaffAccess()` — it is a
 * read-only oversight role with no mutation capability. Server actions
 * that mutate anything must keep requiring `dispatcher`/`admin`
 * explicitly; only read-oriented pages/queries should also accept
 * `viewer`. See PRODUCT.md / TECHNICAL.md "Viewer Role".
 */

/**
 * IMPORTANT: This is a UI convenience only. Role values read on the client
 * (e.g. from a Firebase ID token or a client-side profile fetch) must never
 * be trusted for authorization decisions. Real enforcement happens in
 * server-side domain functions and Firestore Security Rules.
 */
