import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the server-side session boundary (`getSessionUser` /
 * `requireRole`). Every portal page and server action funnels through these:
 * the session cookie is re-verified with the Admin SDK on each request and
 * roles are re-read from Firestore — the client never asserts its own roles.
 * These tests prove the failure modes degrade to "signed out" rather than to
 * access, and that the authorization redirect paths stay intact.
 */

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  verifySessionCookie: vi.fn(),
  getUserProfile: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  logSecurityEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifySessionCookie: mocks.verifySessionCookie }),
}));
vi.mock("@/lib/domain/users", () => ({
  getUserProfile: mocks.getUserProfile,
}));
vi.mock("@/lib/logging", () => ({
  logSecurityEvent: mocks.logSecurityEvent,
  SECURITY_EVENTS: { authorizationDenied: "authorization_denied" },
}));

import { getSessionUser, requireRole } from "@/lib/auth/session";

const PROFILE = { uid: "u1", roles: ["resident"], displayName: "Res" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSessionUser", () => {
  it("returns null when no session cookie is present", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(getSessionUser()).resolves.toBeNull();
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
  });

  it("returns null when the cookie fails verification (expired/revoked/invalid)", async () => {
    mocks.cookieGet.mockReturnValue({ value: "bad-cookie" });
    mocks.verifySessionCookie.mockRejectedValue(
      Object.assign(new Error("expired"), {
        code: "auth/session-cookie-expired",
      }),
    );
    await expect(getSessionUser()).resolves.toBeNull();
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("verifies the cookie with revocation checking enabled", async () => {
    mocks.cookieGet.mockReturnValue({ value: "cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    mocks.getUserProfile.mockResolvedValue(PROFILE);
    await getSessionUser();
    expect(mocks.verifySessionCookie).toHaveBeenCalledWith("cookie", true);
  });

  it("returns null when the verified user has no Firestore profile", async () => {
    mocks.cookieGet.mockReturnValue({ value: "cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    mocks.getUserProfile.mockResolvedValue(null);
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("returns the uid and profile for a valid session", async () => {
    mocks.cookieGet.mockReturnValue({ value: "cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    mocks.getUserProfile.mockResolvedValue(PROFILE);
    await expect(getSessionUser()).resolves.toEqual({
      uid: "u1",
      profile: PROFILE,
    });
  });
});

describe("requireRole", () => {
  it("redirects signed-out visitors to /login without a security event", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(requireRole("resident")).rejects.toThrow("REDIRECT:/login");
    expect(mocks.logSecurityEvent).not.toHaveBeenCalled();
  });

  it("redirects an authenticated user without the role to /access-denied and logs it", async () => {
    mocks.cookieGet.mockReturnValue({ value: "cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    mocks.getUserProfile.mockResolvedValue(PROFILE);

    await expect(requireRole(["dispatcher", "admin"])).rejects.toThrow(
      "REDIRECT:/access-denied",
    );
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith(
      "authorization_denied",
      expect.objectContaining({ uid: "u1", actualRoles: ["resident"] }),
    );
  });

  it("returns the session when the user holds one of the allowed roles", async () => {
    mocks.cookieGet.mockReturnValue({ value: "cookie" });
    mocks.verifySessionCookie.mockResolvedValue({ uid: "u1" });
    mocks.getUserProfile.mockResolvedValue({
      ...PROFILE,
      roles: ["resident", "dispatcher"],
    });
    await expect(requireRole(["dispatcher", "admin"])).resolves.toMatchObject({
      uid: "u1",
    });
  });
});
