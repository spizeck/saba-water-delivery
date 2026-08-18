import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { ensureUserProfile } from "@/lib/domain/users";
import {
  PORTAL_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import type { UserRole } from "@/lib/domain/types";
import { hasRole } from "@/lib/auth/roles";

/**
 * Exchanges a Firebase client ID token for an httpOnly session cookie.
 *
 * Also ensures the signed-in user has a Firestore profile, defaulting a
 * brand-new user's roles to ["resident"] (see ensureUserProfile). This is
 * the only server endpoint involved in establishing a session; it never
 * trusts a role or uid supplied directly by the request body.
 *
 * Returns the user's roles array and a recommended portal to navigate to.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return NextResponse.json(
      { error: "Authentication is not configured on this server yet." },
      { status: 503 },
    );
  }

  let idToken: unknown;
  try {
    ({ idToken } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
  }

  try {
    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const userRecord = await adminAuth.getUser(decoded.uid);

    const profile = await ensureUserProfile({
      uid: decoded.uid,
      displayName: userRecord.displayName ?? userRecord.email?.split("@")[0] ?? "Resident",
      email: userRecord.email ?? null,
      phone: userRecord.phoneNumber ?? null,
    });

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    // Determine which portal to redirect to:
    // 1. If a remembered portal cookie exists and the user still has that role, use it.
    // 2. Otherwise default to "resident" if they have it, then first available role.
    const rememberedPortal = request.cookies.get(PORTAL_COOKIE_NAME)?.value as UserRole | undefined;
    let portal: string;
    if (rememberedPortal && hasRole(profile.roles, rememberedPortal)) {
      portal = rememberedPortal;
    } else if (profile.roles.includes("resident")) {
      portal = "resident";
    } else {
      portal = profile.roles[0] ?? "resident";
    }

    const response = NextResponse.json({ roles: profile.roles, portal });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    // Set/refresh the portal cookie
    response.cookies.set(PORTAL_COOKIE_NAME, portal, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Failed to establish session", error);
    return NextResponse.json({ error: "Sign-in failed. Please try again." }, { status: 401 });
  }
}

/** Signs the current session out by clearing the session cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  response.cookies.set(PORTAL_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
