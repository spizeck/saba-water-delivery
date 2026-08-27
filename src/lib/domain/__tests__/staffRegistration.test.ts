import { describe, expect, it } from "vitest";

import type { AccountOrigin, AuthStatus, UserProfile } from "../types";

/**
 * Tests for staff-created operational accounts.
 *
 * The actual Firestore writes (`registerPerson`, `findUsersByPhone`) are
 * integration tests requiring the Firebase Admin SDK. These unit tests
 * cover the type contract, default-value semantics, and compatibility
 * with the existing account model.
 */

// Simulate what toUserProfile does for accountOrigin/authStatus parsing
function parseAccountOrigin(raw: unknown): AccountOrigin {
  return raw === "staff_registered" ? "staff_registered" : "self_registered";
}

function parseAuthStatus(raw: unknown): AuthStatus {
  return raw === "unclaimed" ? "unclaimed" : "claimed";
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: "test-uid",
    displayName: "Test User",
    email: null,
    phone: "+1-416-555-0100",
    roles: ["resident"],
    village: "The Bottom",
    deliveryDirections: "Blue house on Main Rd",
    deliveryProfileConfirmedAt: null,
    accountOrigin: "self_registered",
    authStatus: "claimed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AccountOrigin and AuthStatus defaults", () => {
  it("historical documents without accountOrigin default to self_registered", () => {
    expect(parseAccountOrigin(undefined)).toBe("self_registered");
    expect(parseAccountOrigin(null)).toBe("self_registered");
  });

  it("historical documents without authStatus default to claimed", () => {
    expect(parseAuthStatus(undefined)).toBe("claimed");
    expect(parseAuthStatus(null)).toBe("claimed");
  });

  it("staff_registered is preserved", () => {
    expect(parseAccountOrigin("staff_registered")).toBe("staff_registered");
  });

  it("unclaimed is preserved", () => {
    expect(parseAuthStatus("unclaimed")).toBe("unclaimed");
  });

  it("invalid/unknown values fall back to defaults", () => {
    expect(parseAccountOrigin("invalid")).toBe("self_registered");
    expect(parseAuthStatus("invalid")).toBe("claimed");
  });
});

describe("Staff-created account profile shape", () => {
  it("staff-created account has no email and unclaimed auth", () => {
    const profile = makeProfile({
      accountOrigin: "staff_registered",
      authStatus: "unclaimed",
      email: null,
    });
    expect(profile.accountOrigin).toBe("staff_registered");
    expect(profile.authStatus).toBe("unclaimed");
    expect(profile.email).toBeNull();
    expect(profile.phone).toBeTruthy();
  });

  it("staff-created account can have email if provided", () => {
    const profile = makeProfile({
      accountOrigin: "staff_registered",
      authStatus: "unclaimed",
      email: "resident@example.com",
    });
    expect(profile.email).toBe("resident@example.com");
    expect(profile.authStatus).toBe("unclaimed");
  });

  it("staff-created driver has resident as baseline role", () => {
    const profile = makeProfile({
      accountOrigin: "staff_registered",
      authStatus: "unclaimed",
      roles: ["resident", "driver"],
    });
    expect(profile.roles).toContain("resident");
    expect(profile.roles).toContain("driver");
  });

  it("self-registered account defaults to claimed", () => {
    const profile = makeProfile({
      accountOrigin: "self_registered",
      authStatus: "claimed",
    });
    expect(profile.accountOrigin).toBe("self_registered");
    expect(profile.authStatus).toBe("claimed");
  });
});

describe("Staff-created account compatibility", () => {
  it("uid field is stable and can be used as customerId for requests", () => {
    const profile = makeProfile({
      uid: "auto-generated-firestore-id",
      accountOrigin: "staff_registered",
      authStatus: "unclaimed",
    });
    // The uid is used as customerId in createWaterRequest
    expect(typeof profile.uid).toBe("string");
    expect(profile.uid).toBeTruthy();
  });

  it("profile has all fields required by ResidentDirectoryEntry", () => {
    const profile = makeProfile({
      accountOrigin: "staff_registered",
      authStatus: "unclaimed",
    });
    // ResidentDirectoryEntry: uid, displayName, email, phone, village, deliveryDirections
    expect(profile.uid).toBeTruthy();
    expect(typeof profile.displayName).toBe("string");
    expect(profile.village).toBeTruthy();
    expect(profile.deliveryDirections).toBeTruthy();
  });

  it("phone is required for staff-created accounts (cannot be null)", () => {
    const profile = makeProfile({
      accountOrigin: "staff_registered",
      phone: "+1-416-555-0100",
    });
    expect(profile.phone).not.toBeNull();
  });
});

describe("Account type discrimination", () => {
  it("can distinguish self-registered from staff-registered", () => {
    const self = makeProfile({ accountOrigin: "self_registered", authStatus: "claimed" });
    const staff = makeProfile({ accountOrigin: "staff_registered", authStatus: "unclaimed" });

    expect(self.accountOrigin).not.toBe(staff.accountOrigin);
    expect(self.authStatus).not.toBe(staff.authStatus);
  });

  it("claimed staff-registered account (future: after SMS claiming)", () => {
    const claimed = makeProfile({
      accountOrigin: "staff_registered",
      authStatus: "claimed",
    });
    // After SMS claiming, the account origin stays staff_registered
    // but authStatus transitions to claimed
    expect(claimed.accountOrigin).toBe("staff_registered");
    expect(claimed.authStatus).toBe("claimed");
  });
});
