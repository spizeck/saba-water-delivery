import { describe, expect, it } from "vitest";

import { isValidSabaVillage, SABA_VILLAGES } from "@/lib/domain/villages";

describe("isValidSabaVillage", () => {
  it("accepts every canonical village", () => {
    for (const village of SABA_VILLAGES) {
      expect(isValidSabaVillage(village)).toBe(true);
    }
  });

  it("rejects arbitrary, blank, and non-string values", () => {
    expect(isValidSabaVillage("Somewhere Else")).toBe(false);
    expect(isValidSabaVillage("")).toBe(false);
    expect(isValidSabaVillage(null)).toBe(false);
    expect(isValidSabaVillage(undefined)).toBe(false);
    expect(isValidSabaVillage(5)).toBe(false);
  });

  it("rejects legacy/noncanonical village spellings", () => {
    expect(isValidSabaVillage("St. John's")).toBe(false);
    expect(isValidSabaVillage("St Johns")).toBe(true);
    expect(isValidSabaVillage("Zion's Hill - Lower")).toBe(false);
    expect(isValidSabaVillage("Zions Hill - Lower")).toBe(true);
    expect(isValidSabaVillage("Bottom")).toBe(false);
    expect(isValidSabaVillage("The Bottom")).toBe(true);
  });
});
