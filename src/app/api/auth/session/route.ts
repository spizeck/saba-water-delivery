import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { ensureUserProfile } from "@/lib/domain/users";
import { getDriverByLinkedUserId } from "@/lib/domain/driverRegistry";
import {
  PORTAL_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import type { UserRole } from "@/lib/domain/types";
import { hasRole, isUserRole } from "@/lib/auth/roles";

/**
 * Exchanges a Firebase client ID token for an httpOnly session cookie.
 *
 * Also ensures the signed-in user has a Firestore profile, defaulting a
 * brand-new user's roles to ["resident"]. This is the only server endpoint
 * involved in establishing a session; it never trusts a role or uid supplied
 * directly by the request body.
 *
 * The optional `intendedPortal` from the request body is the explicit portal
 * the user chose on the homepage. It is validated against the canonical role
 * list and the user's actual roles to avoid open redirects. The driver portal
 * additionally requires a linked Driver Registry entry.
 */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return NextResponse.json(
      { error: "Authentication is not configured on this server yet." },
      { status: 503 },
    );
  }

  let idToken: unknown;
  let intendedPortal: unknown;
  try {
    const body = await request.json();
    idToken = body.idToken;
    intendedPortal = body.intendedPortal;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
  }

  if (intendedPortal != null && (typeof intendedPortal !== "string" || !isUserRole(intendedPortal))) {
    return NextResponse.json({ error: "Invalid intended portal." }, { status: 400 });
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

    const requestedPortal = intendedPortal as UserRole | undefined;
    let portal: string;

    if (requestedPortal && hasRole(profile.roles, requestedPortal)) {
      if (requestedPortal === "driver") {
        const linkedDriver = await getDriverByLinkedUserId(decoded.uid);
        if (!linkedDriver) {
          return NextResponse.json(
            { error: "DRIVER_ACCESS_DENIED" },
            { status: 403 },
          );
        }
      }
      portal = requestedPortal;
    } else if (requestedPortal === "driver" && !hasRole(profile.roles, "driver")) {
      return NextResponse.json(
        { error: "DRIVER_ACCESS_DENIED" },
        { status: 403 },
      );
    } else {
      // No valid explicit intent: fall back to remembered portal cookie, then
      // to the default resident portal.
      const rememberedPortal = request.cookies.get(PORTAL_COOKIE_NAME)?.value as UserRole | undefined;
      if (rememberedPortal && hasRole(profile.roles, rememberedPortal)) {
        portal = rememberedPortal;
      } else if (profile.roles.includes("resident")) {
        portal = "resident";
      } else {
        portal = profile.roles[0] ?? "resident";
      }
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
