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
import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";
import { withApiRoute } from "@/lib/http";
import { enforceRateLimit, getTrustedClientIp } from "@/lib/security/rateLimit";

const log = getLogger("api.auth.session");

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
export const POST = withApiRoute(
  "auth.session",
  async (request: NextRequest) => {
    return handleSessionPost(request);
  },
);

async function handleSessionPost(request: NextRequest) {
  // Abuse protection for this pre-auth, public endpoint, keyed by the
  // edge-trusted client IP. Exceeding the (generous) limit throws
  // AppRateLimitError, which withApiRoute turns into a 429 with Retry-After.
  // On Vercel the IP is trusted; locally it is null and limiting is inactive.
  await enforceRateLimit("auth-session", {
    type: "ip",
    value: getTrustedClientIp(request),
  });

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
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
  }

  if (
    intendedPortal != null &&
    (typeof intendedPortal !== "string" || !isUserRole(intendedPortal))
  ) {
    return NextResponse.json(
      { error: "Invalid intended portal." },
      { status: 400 },
    );
  }

  try {
    const adminAuth = getAdminAuth();
    // checkRevoked=true: a token minted for a since-disabled or revoked
    // identity (e.g. a merged-away account already made safe by
    // reconciliation) must never establish a NEW session.
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const userRecord = await adminAuth.getUser(decoded.uid);

    if (userRecord.disabled) {
      // A disabled identity can reach here only via a token minted before the
      // disable landed (verify above already enforces disabled/revoked, so
      // this is belt-and-suspenders against ordering races).
      return NextResponse.json(
        {
          error:
            "This account is no longer active. Contact staff if you need help.",
        },
        { status: 401 },
      );
    }

    const { profile, created } = await ensureUserProfile({
      uid: decoded.uid,
      displayName:
        userRecord.displayName ?? userRecord.email?.split("@")[0] ?? "Resident",
      email: userRecord.email ?? null,
      phone: userRecord.phoneNumber ?? null,
    });

    // Merged-away identities can never establish a session — the marker is
    // written inside the merge transaction, so this rejection holds from the
    // moment the merge commits even while Auth cleanup is still pending
    // (issue #73). Checked before any session cookie is minted.
    if (profile.mergedIntoUserId) {
      logSecurityEvent(SECURITY_EVENTS.mergedIdentityRejected, {
        uid: decoded.uid,
        boundary: "session_creation",
      });
      return NextResponse.json(
        {
          error:
            "This account was merged into another account and can no longer sign in. Contact staff if you need help.",
        },
        { status: 403 },
      );
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    const requestedPortal = intendedPortal as UserRole | undefined;
    let portal: string;

    if (requestedPortal && hasRole(profile.roles, requestedPortal)) {
      if (requestedPortal === "driver") {
        const linkedDriver = await getDriverByLinkedUserId(decoded.uid);
        if (!linkedDriver) {
          logSecurityEvent(SECURITY_EVENTS.authorizationDenied, {
            uid: decoded.uid,
            portal: "driver",
            reason: "no_linked_driver",
          });
          return NextResponse.json(
            { error: "DRIVER_ACCESS_DENIED" },
            { status: 403 },
          );
        }
      }
      portal = requestedPortal;
    } else if (
      requestedPortal === "driver" &&
      !hasRole(profile.roles, "driver")
    ) {
      logSecurityEvent(SECURITY_EVENTS.authorizationDenied, {
        uid: decoded.uid,
        portal: "driver",
        reason: "missing_driver_role",
      });
      return NextResponse.json(
        { error: "DRIVER_ACCESS_DENIED" },
        { status: 403 },
      );
    } else {
      // No valid explicit intent: fall back to remembered portal cookie, then
      // to the default resident portal.
      const rememberedPortal = request.cookies.get(PORTAL_COOKIE_NAME)
        ?.value as UserRole | undefined;
      if (rememberedPortal && hasRole(profile.roles, rememberedPortal)) {
        portal = rememberedPortal;
      } else if (profile.roles.includes("resident")) {
        portal = "resident";
      } else {
        portal = profile.roles[0] ?? "resident";
      }
    }

    const response = NextResponse.json({
      roles: profile.roles,
      portal,
      created,
    });
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
    // The thrown value is typically a Firebase Auth error; serializeError
    // keeps its name/code (e.g. "auth/id-token-expired") but never the token.
    log.warn("auth.session.verify_failed", { error: serializeError(error) });
    return NextResponse.json(
      { error: "Sign-in failed. Please try again." },
      { status: 401 },
    );
  }
}

/** Signs the current session out by clearing the session cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  response.cookies.set(PORTAL_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
