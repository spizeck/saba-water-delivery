import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";

describe("formatPhoneForDisplay", () => {
  it("returns null for blank or null input", () => {
    expect(formatPhoneForDisplay(null)).toBeNull();
    expect(formatPhoneForDisplay("")).toBeNull();
    expect(formatPhoneForDisplay("   ")).toBeNull();
  });

  it("formats Saba numbers stored without spaces", () => {
    expect(formatPhoneForDisplay("+5994165363")).toBe("+599 416 5363");
  });

  it("preserves an already-formatted Saba number", () => {
    expect(formatPhoneForDisplay("+599 416 5363")).toBe("+599 416 5363");
  });

  it("formats US numbers in E.164 form", () => {
    expect(formatPhoneForDisplay("+16026792963")).toBe("+1 602 679 2963");
  });

  it("formats 10-digit numbers without a country code", () => {
    expect(formatPhoneForDisplay("6026792963")).toBe("602 679 2963");
  });

  it("does not alter the stored value when formatting cannot improve it", () => {
    expect(formatPhoneForDisplay("123")).toBe("123");
  });

  it("trims whitespace before formatting", () => {
    expect(formatPhoneForDisplay("  +5994165363  ")).toBe("+599 416 5363");
  });
});
