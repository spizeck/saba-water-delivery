import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminAuth } from "@/lib/firebase/admin";
import { getUserProfile } from "@/lib/domain/users";
import { hasRole } from "@/lib/auth/roles";
import type { UserProfile, UserRole } from "@/lib/domain/types";

/**
 * Server-side session handling.
 *
 * The application uses Firebase session cookies rather than trusting a
 * client-supplied ID token or role on every request: after the client
 * signs in with Firebase Authentication, it exchanges its ID token for an
 * httpOnly session cookie via POST /api/auth/session (see that route).
 * From then on, every server-rendered request re-verifies the cookie
 * with the Firebase Admin SDK and re-reads the user's roles from
 * Firestore — the browser never gets to assert its own roles.
 */
export const SESSION_COOKIE_NAME = "session";
export const PORTAL_COOKIE_NAME = "portal";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

export interface SessionUser {
  uid: string;
  profile: UserProfile;
}

/** Resolves the current request's authenticated user, or null if signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    const profile = await getUserProfile(decoded.uid);
    if (!profile) return null;
    return { uid: decoded.uid, profile };
  } catch {
    // Missing/expired/revoked/invalid cookie, or Admin SDK not configured.
    return null;
  }
}

/**
 * Authorization boundary for portal routes/actions.
 *
 * Redirects to /login when there is no valid session, or to
 * /access-denied when the user's roles array does not contain at least
 * one of the `allowed` roles. Never relies on the client to report its
 * own roles.
 */
export async function requireRole(allowed: UserRole | UserRole[]): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  if (!hasRole(session.profile.roles, allowed)) redirect("/access-denied");

  return session;
}
