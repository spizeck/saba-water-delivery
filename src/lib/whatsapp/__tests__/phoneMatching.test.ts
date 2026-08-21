import { describe, expect, it } from "vitest";

import type { ResidentDirectoryEntry } from "@/lib/domain/users";
import { matchResidentByPhoneFromDirectory, normalizePhoneForMatching } from "@/lib/whatsapp/phoneMatching";

function resident(overrides: Partial<ResidentDirectoryEntry> = {}): ResidentDirectoryEntry {
  return {
    uid: "uid-1",
    displayName: "Jane Resident",
    email: null,
    phone: "+599 416 5363",
    village: "Windwardside",
    deliveryDirections: "Blue gate",
    ...overrides,
  };
}

describe("normalizePhoneForMatching", () => {
  it("strips formatting characters down to digits", () => {
    expect(normalizePhoneForMatching("+599 416 5363")).toBe("5994165363");
    expect(normalizePhoneForMatching("599-416-5363")).toBe("5994165363");
    expect(normalizePhoneForMatching("5994165363")).toBe("5994165363");
  });

  it("returns null for empty/blank/missing input", () => {
    expect(normalizePhoneForMatching(null)).toBeNull();
    expect(normalizePhoneForMatching(undefined)).toBeNull();
    expect(normalizePhoneForMatching("")).toBeNull();
    expect(normalizePhoneForMatching("   ")).toBeNull();
  });
});

describe("matchResidentByPhoneFromDirectory", () => {
  it("returns a unique match when exactly one resident's normalized phone matches", () => {
    const directory = [resident({ uid: "uid-1", phone: "+599 416 5363" }), resident({ uid: "uid-2", phone: "+599 000 0000" })];
    const result = matchResidentByPhoneFromDirectory("5994165363", directory);
    expect(result).toEqual({ type: "unique", resident: directory[0] });
  });

  it("matches across different phone formatting", () => {
    const directory = [resident({ uid: "uid-1", phone: "599-416-5363" })];
    const result = matchResidentByPhoneFromDirectory("5994165363", directory);
    expect(result).toEqual({ type: "unique", resident: directory[0] });
  });

  it("returns none when no resident's phone matches", () => {
    const directory = [resident({ phone: "+599 000 0000" })];
    expect(matchResidentByPhoneFromDirectory("5994165363", directory)).toEqual({ type: "none" });
  });

  it("returns none for an empty directory", () => {
    expect(matchResidentByPhoneFromDirectory("5994165363", [])).toEqual({ type: "none" });
  });

  it("returns ambiguous when more than one resident shares the same normalized phone", () => {
    const directory = [
      resident({ uid: "uid-1", phone: "+599 416 5363" }),
      resident({ uid: "uid-2", phone: "599-416-5363" }),
    ];
    expect(matchResidentByPhoneFromDirectory("5994165363", directory)).toEqual({ type: "ambiguous" });
  });

  it("never matches residents with no phone on file", () => {
    const directory = [resident({ phone: null })];
    expect(matchResidentByPhoneFromDirectory("5994165363", directory)).toEqual({ type: "none" });
  });
});
