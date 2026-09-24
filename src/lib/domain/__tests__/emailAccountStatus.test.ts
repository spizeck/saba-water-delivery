import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for `getEmailAccountStatus` (issue #125): the dispatcher
 * new-request form looks up an optional customer email against Firebase
 * Auth, so partial/invalid typing input must resolve to the safe
 * non-match shape instead of throwing `auth/invalid-email` into Sentry.
 * Unexpected Firebase Auth failures must still propagate.
 */

const mocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ getUserByEmail: mocks.getUserByEmail }),
  getAdminDb: () => ({}),
}));

import {
  createAccountInvitation,
  getEmailAccountStatus,
} from "@/lib/domain/identity";

const NO_MATCH = { exists: false, uid: null, displayName: null, email: null };

function firebaseError(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("getEmailAccountStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the safe non-match shape without calling Auth for empty input", async () => {
    expect(await getEmailAccountStatus("")).toEqual(NO_MATCH);
    expect(await getEmailAccountStatus("   ")).toEqual(NO_MATCH);
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
  });

  it("never calls Auth for malformed input like a@ typed mid-entry", async () => {
    expect(await getEmailAccountStatus("a@")).toEqual(NO_MATCH);
    expect(await getEmailAccountStatus("a@b")).toEqual(NO_MATCH);
    expect(await getEmailAccountStatus("not-an-email")).toEqual(NO_MATCH);
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
  });

  it("returns the safe non-match shape when Firebase throws auth/invalid-email", async () => {
    mocks.getUserByEmail.mockRejectedValue(
      firebaseError(
        "auth/invalid-email",
        "The email address is improperly formatted.",
      ),
    );
    expect(await getEmailAccountStatus("a@b.c")).toEqual(NO_MATCH);
  });

  it("returns the safe non-match shape for auth/user-not-found", async () => {
    mocks.getUserByEmail.mockRejectedValue(
      firebaseError("auth/user-not-found", "no user"),
    );
    expect(await getEmailAccountStatus("missing@example.com")).toEqual(
      NO_MATCH,
    );
  });

  it("returns account details for an existing user", async () => {
    mocks.getUserByEmail.mockResolvedValue({
      uid: "uid-1",
      displayName: "Bruce Zagers",
      email: "bruce@example.com",
    });
    expect(await getEmailAccountStatus(" Bruce@Example.COM ")).toEqual({
      exists: true,
      uid: "uid-1",
      displayName: "Bruce Zagers",
      email: "bruce@example.com",
    });
    expect(mocks.getUserByEmail).toHaveBeenCalledWith("bruce@example.com");
  });

  it("propagates unexpected Firebase Auth failures", async () => {
    const outage = firebaseError("auth/internal-error", "backend down");
    mocks.getUserByEmail.mockRejectedValue(outage);
    await expect(getEmailAccountStatus("bruce@example.com")).rejects.toBe(
      outage,
    );
  });
});

describe("createAccountInvitation", () => {
  it("rejects malformed email as a business error before touching Auth", async () => {
    await expect(createAccountInvitation("a@", "Bruce")).rejects.toThrow(
      "INVALID_EMAIL",
    );
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
  });
});
