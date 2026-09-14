import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for POST/DELETE /api/auth/session — the one server endpoint that
 * exchanges a Firebase ID token for an httpOnly session cookie. Covered here:
 * fail-closed when Admin is unconfigured, request-shape validation, token
 * verification, first-login profile provisioning, portal selection rules
 * (including Driver Registry gating), cookie attributes, and logout.
 * Firestore writes behind `ensureUserProfile` are emulator-covered in
 * `src/lib/domain/__tests__/userProvisioning.emulator.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
  createSessionCookie: vi.fn(),
  ensureUserProfile: vi.fn(),
  getDriverByLinkedUserId: vi.fn(),
  configured: { value: true },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({
  get isFirebaseAdminConfigured() {
    return mocks.configured.value;
  },
  getAdminAuth: () => ({
    verifyIdToken: mocks.verifyIdToken,
    getUser: mocks.getUser,
    createSessionCookie: mocks.createSessionCookie,
  }),
}));
vi.mock("@/lib/domain/users", () => ({
  ensureUserProfile: mocks.ensureUserProfile,
}));
vi.mock("@/lib/domain/driverRegistry", () => ({
  getDriverByLinkedUserId: mocks.getDriverByLinkedUserId,
}));

vi.mock("@/lib/security/rateLimit", () => ({
  enforceRateLimit: vi.fn(),
  getTrustedClientIp: () => null,
}));

import { DELETE, POST } from "@/app/api/auth/session/route";

function makeRequest(body?: unknown, cookies?: Record<string, string>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cookies) {
    headers.cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/auth/session",
    {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

const RESIDENT_PROFILE = {
  profile: { uid: "u1", roles: ["resident"], displayName: "Res" },
  created: false,
};

function arrangeValidToken() {
  mocks.verifyIdToken.mockResolvedValue({ uid: "u1" });
  mocks.getUser.mockResolvedValue({
    uid: "u1",
    displayName: "Res",
    email: "res@example.com",
    phoneNumber: null,
  });
  mocks.ensureUserProfile.mockResolvedValue(RESIDENT_PROFILE);
  mocks.createSessionCookie.mockResolvedValue("session-cookie-value");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.value = true;
});

describe("POST /api/auth/session — configuration and request shape", () => {
  it("fails closed with 503 when Firebase Admin is not configured", async () => {
    mocks.configured.value = false;
    const response = await POST(makeRequest({ idToken: "t" }));
    expect(response.status).toBe(503);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects an unparseable body with 400", async () => {
    const request = new NextRequest(
      "https://saba-water-delivery.vercel.app/api/auth/session",
      { method: "POST", body: "not-json" },
    );
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects a missing idToken with 400", async () => {
    const response = await POST(makeRequest({ intendedPortal: "resident" }));
    expect(response.status).toBe(400);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a non-role intendedPortal with 400 (no open redirect)", async () => {
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "https://evil.example" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/session — token verification and provisioning", () => {
  it("returns 401 when the ID token fails verification", async () => {
    mocks.verifyIdToken.mockRejectedValue(
      Object.assign(new Error("expired"), { code: "auth/id-token-expired" }),
    );
    const response = await POST(makeRequest({ idToken: "t" }));
    expect(response.status).toBe(401);
    expect(mocks.ensureUserProfile).not.toHaveBeenCalled();
  });

  it("provisions the profile server-side and never trusts a body-supplied role", async () => {
    arrangeValidToken();
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "admin" }),
    );
    const body = await response.json();

    // uid comes from the verified token, not the request body.
    expect(mocks.ensureUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "u1" }),
    );
    // A resident-only user asking for the admin portal is routed to resident.
    expect(body.portal).toBe("resident");
    expect(body.roles).toEqual(["resident"]);
  });

  it("sets an httpOnly session cookie and a readable portal cookie", async () => {
    arrangeValidToken();
    const response = await POST(makeRequest({ idToken: "t" }));
    const setCookie = response.headers.getSetCookie();

    const session = setCookie.find((c) => c.startsWith("session="));
    const portal = setCookie.find((c) => c.startsWith("portal="));
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Max-Age=432000"); // SESSION_MAX_AGE_SECONDS (5d)
    expect(session).toContain("SameSite=lax");
    expect(portal).toContain("portal=resident");
    expect(portal).not.toContain("HttpOnly");
  });
});

describe("POST /api/auth/session — portal selection", () => {
  it("routes to the requested portal when the user holds that role", async () => {
    arrangeValidToken();
    mocks.ensureUserProfile.mockResolvedValue({
      profile: { uid: "u1", roles: ["dispatcher", "resident"] },
      created: false,
    });
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "dispatcher" }),
    );
    expect((await response.json()).portal).toBe("dispatcher");
  });

  it("honours the remembered portal cookie when no intent is given", async () => {
    arrangeValidToken();
    mocks.ensureUserProfile.mockResolvedValue({
      profile: { uid: "u1", roles: ["viewer", "resident"] },
      created: false,
    });
    const response = await POST(
      makeRequest({ idToken: "t" }, { portal: "viewer" }),
    );
    expect((await response.json()).portal).toBe("viewer");
  });

  it("denies the driver portal without the driver role", async () => {
    arrangeValidToken();
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "driver" }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("DRIVER_ACCESS_DENIED");
  });

  it("denies the driver portal when the user has the role but no linked Driver Registry entry", async () => {
    arrangeValidToken();
    mocks.ensureUserProfile.mockResolvedValue({
      profile: { uid: "u1", roles: ["driver", "resident"] },
      created: false,
    });
    mocks.getDriverByLinkedUserId.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "driver" }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("DRIVER_ACCESS_DENIED");
  });

  it("admits the driver portal when role and linked registry entry both exist", async () => {
    arrangeValidToken();
    mocks.ensureUserProfile.mockResolvedValue({
      profile: { uid: "u1", roles: ["driver", "resident"] },
      created: false,
    });
    mocks.getDriverByLinkedUserId.mockResolvedValue({ id: "driver-1" });
    const response = await POST(
      makeRequest({ idToken: "t", intendedPortal: "driver" }),
    );
    expect((await response.json()).portal).toBe("driver");
  });
});

describe("DELETE /api/auth/session", () => {
  it("clears both the session and portal cookies", async () => {
    const response = await DELETE();
    const setCookie = response.headers.getSetCookie();

    const session = setCookie.find((c) => c.startsWith("session="));
    const portal = setCookie.find((c) => c.startsWith("portal="));
    expect(session).toContain("Max-Age=0");
    expect(portal).toContain("Max-Age=0");
  });
});
