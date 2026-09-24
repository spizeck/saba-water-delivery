import { describe, expect, it } from "vitest";

import {
  buildUnionMergeRoles,
  findIdentityMatches,
  findPhoneMatches,
  findStrongEmailMatch,
  isValidEmail,
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
    expect(normalizeEmailForMatching("Bruce@Example.COM")).toBe(
      "bruce@example.com",
    );
  });

  it("returns null for empty input", () => {
    expect(normalizeEmailForMatching(null)).toBeNull();
    expect(normalizeEmailForMatching("  ")).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("bruce@example.com")).toBe(true);
    expect(isValidEmail("  Bruce@Example.COM  ")).toBe(true);
    expect(isValidEmail("a.b+c@sub.domain.co")).toBe(true);
  });

  it("rejects empty and partial input", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("a@")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("a@.com")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail("a@@example.com")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
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
    expect(
      matches.some((m) => m.resident.uid === "u1" && m.strength === "medium"),
    ).toBe(true);
    expect(
      matches.some((m) => m.resident.uid === "u3" && m.strength === "medium"),
    ).toBe(true);
  });

  it("never auto-matches on name alone", () => {
    const matches = findIdentityMatches(
      { name: "Bruce Zagers", phone: null, email: null },
      directory,
    );
    // Name-only matches are weak and excluded from default filtering in UI,
    // but the pure function still returns them as "weak".
    expect(matches.length).toBeGreaterThan(0);
    expect(
      matches.every(
        (m) => m.strength === "weak" && m.matchedOn.includes("name"),
      ),
    ).toBe(true);
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
    const match = findStrongEmailMatch(
      { email: "bruce@example.com" },
      directory,
    );
    expect(match?.resident.uid).toBe("u1");
  });

  it("returns null when no email match", () => {
    expect(
      findStrongEmailMatch({ email: "unknown@example.com" }, directory),
    ).toBeNull();
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

describe("buildUnionMergeRoles", () => {
  it("preserves every canonical role, including sensitive ones (#95)", () => {
    // The confirmed pilot incident shape: a privileged canonical merged with
    // a resident duplicate must keep all of its roles.
    const result = buildUnionMergeRoles(
      ["resident", "driver", "dispatcher", "admin"] as UserRole[],
      ["resident"] as UserRole[],
    );
    expect(result).toEqual(["admin", "dispatcher", "driver", "resident"]);
  });

  it("never imports privileged roles from the duplicate", () => {
    const result = buildUnionMergeRoles(
      ["resident"] as UserRole[],
      ["resident", "admin", "dispatcher", "driver"] as UserRole[],
    );
    expect(result).toEqual(["resident"]);
  });

  it("imports only resident/viewer from the duplicate", () => {
    const result = buildUnionMergeRoles(
      ["resident"] as UserRole[],
      ["viewer", "driver"] as UserRole[],
    );
    expect(result).toEqual(["resident", "viewer"]);
  });

  it.each<[UserRole[], UserRole[], UserRole[]]>([
    [["viewer"], ["resident"], ["resident", "viewer"]],
    [["admin"], ["viewer"], ["admin", "viewer"]],
    [["dispatcher"], ["viewer"], ["dispatcher", "viewer"]],
    [["driver"], ["viewer"], ["driver", "viewer"]],
    [
      ["admin", "dispatcher", "driver"],
      ["admin", "dispatcher", "driver"],
      ["admin", "dispatcher", "driver"],
    ],
    [["resident"], ["resident"], ["resident"]],
    [[], ["viewer"], ["viewer"]],
    [["admin"], [], ["admin"]],
  ])("canonical %j + duplicate %j => %j", (canonical, duplicate, expected) => {
    expect(buildUnionMergeRoles(canonical, duplicate)).toEqual(expected);
  });
});
