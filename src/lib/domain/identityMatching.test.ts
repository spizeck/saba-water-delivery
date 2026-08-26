import { describe, expect, it } from "vitest";

import {
  buildDefaultUnionRoles,
  findIdentityMatches,
  findPhoneMatches,
  findStrongEmailMatch,
  namesLookSimilar,
  normalizeEmailForMatching,
  normalizePhoneForMatching,
} from "./identityMatching";
import type { ResidentDirectoryEntry } from "./users";
import type { UserRole } from "./types";

const directory: ResidentDirectoryEntry[] = [
  {
    uid: "u1",
    displayName: "Bruce Zagers",
    email: "bruce@example.com",
    phone: "+599 416 1111",
    village: "The Bottom",
    deliveryDirections: "",
  },
  {
    uid: "u2",
    displayName: "Bruce Zagers",
    email: "bruce.zagers@example.com",
    phone: "599-416-2222",
    village: "St Johns",
    deliveryDirections: "",
  },
  {
    uid: "u3",
    displayName: "Maria Johnson",
    email: null,
    phone: "5994161111",
    village: "Windwardside",
    deliveryDirections: "",
  },
];

describe("normalizePhoneForMatching", () => {
  it("strips non-digits", () => {
    expect(normalizePhoneForMatching("+599 416 1111")).toBe("5994161111");
    expect(normalizePhoneForMatching("599-416-2222")).toBe("5994162222");
  });

  it("returns null for empty input", () => {
    expect(normalizePhoneForMatching(null)).toBeNull();
    expect(normalizePhoneForMatching("   ")).toBeNull();
  });
});

describe("normalizeEmailForMatching", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmailForMatching("Bruce@Example.COM")).toBe("bruce@example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeEmailForMatching(null)).toBeNull();
    expect(normalizeEmailForMatching("  ")).toBeNull();
  });
});

describe("namesLookSimilar", () => {
  it("matches identical names", () => {
    expect(namesLookSimilar("Bruce Zagers", "Bruce Zagers")).toBe(true);
  });

  it("matches when one contains the other", () => {
    expect(namesLookSimilar("Bruce Zagers", "Bruce Zagers Jr")).toBe(true);
  });

  it("ignores case and extra spaces", () => {
    expect(namesLookSimilar("BRUCE  ZAGERS", "bruce zagers")).toBe(true);
  });

  it("does not match short or unrelated strings", () => {
    expect(namesLookSimilar("B", "Bruce Zagers")).toBe(false);
    expect(namesLookSimilar("Bruce Zagers", "Maria Johnson")).toBe(false);
  });
});

describe("findIdentityMatches", () => {
  it("returns strong match for exact email", () => {
    const matches = findIdentityMatches(
      { name: "Bruce", phone: "+1 555", email: "bruce@example.com" },
      directory,
    );
    const strong = matches.filter((m) => m.strength === "strong");
    expect(strong).toHaveLength(1);
    expect(strong[0].resident.uid).toBe("u1");
    expect(strong[0].matchedOn).toContain("email");
  });

  it("returns medium match for exact phone without email", () => {
    const matches = findIdentityMatches(
      { name: "Bruce", phone: "5994161111", email: null },
      directory,
    );
    // u1 matches phone; u3 matches the same phone.
    expect(matches.some((m) => m.resident.uid === "u1" && m.strength === "medium")).toBe(true);
    expect(matches.some((m) => m.resident.uid === "u3" && m.strength === "medium")).toBe(true);
  });

  it("never auto-matches on name alone", () => {
    const matches = findIdentityMatches(
      { name: "Bruce Zagers", phone: null, email: null },
      directory,
    );
    // Name-only matches are weak and excluded from default filtering in UI,
    // but the pure function still returns them as "weak".
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.strength === "weak" && m.matchedOn.includes("name"))).toBe(
      true,
    );
  });

  it("does not double-count email and phone on the same resident", () => {
    const matches = findIdentityMatches(
      { name: "Bruce Zagers", phone: "5994161111", email: "bruce@example.com" },
      directory,
    );
    const bruce = matches.find((m) => m.resident.uid === "u1");
    expect(bruce?.strength).toBe("strong");
    expect(bruce?.matchedOn).toContain("email");
    expect(bruce?.matchedOn).toContain("phone");
  });
});

describe("findStrongEmailMatch", () => {
  it("returns the single email match", () => {
    const match = findStrongEmailMatch({ email: "bruce@example.com" }, directory);
    expect(match?.resident.uid).toBe("u1");
  });

  it("returns null when no email match", () => {
    expect(findStrongEmailMatch({ email: "unknown@example.com" }, directory)).toBeNull();
  });
});

describe("findPhoneMatches", () => {
  it("excludes the strong email match", () => {
    const matches = findPhoneMatches(
      { phone: "5994161111", email: "bruce@example.com" },
      directory,
    );
    expect(matches.some((m) => m.resident.uid === "u1")).toBe(false);
    expect(matches.some((m) => m.resident.uid === "u3")).toBe(true);
  });
});

describe("buildDefaultUnionRoles", () => {
  it("unions non-sensitive roles and excludes sensitive ones", () => {
    const result = buildDefaultUnionRoles(
      ["resident", "viewer"] as UserRole[],
      ["resident", "admin", "driver"] as UserRole[],
    );
    expect(result).toEqual(["resident", "viewer"]);
  });

  it("returns empty when only sensitive roles are present", () => {
    expect(buildDefaultUnionRoles(["admin"], ["driver"])).toEqual([]);
  });
});
