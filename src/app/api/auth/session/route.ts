import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { ensureUserProfile } from "@/lib/domain/users";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

/**
 * Exchanges a Firebase client ID token for an httpOnly session cookie.
 *
 * Also ensures the signed-in user has a Firestore profile, defaulting a
 * brand-new user's role to "resident" (see ensureUserProfile). This is
 * the only server endpoint involved in establishing a session; it never
 * trusts a role or uid supplied directly by the request body.
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

    const response = NextResponse.json({ role: profile.role });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
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
  return response;
}
