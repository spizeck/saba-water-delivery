import { describe, expect, it } from "vitest";

import { isValidSabaVillage, SABA_VILLAGES } from "@/lib/domain/villages";

describe("isValidSabaVillage", () => {
  it("accepts every canonical village", () => {
    for (const village of SABA_VILLAGES) {
      expect(isValidSabaVillage(village)).toBe(true);
    }
  });

  it("rejects arbitrary strings and non-strings", () => {
    expect(isValidSabaVillage("Somewhere Else")).toBe(false);
    expect(isValidSabaVillage("")).toBe(false);
    expect(isValidSabaVillage(null)).toBe(false);
    expect(isValidSabaVillage(undefined)).toBe(false);
    expect(isValidSabaVillage(5)).toBe(false);
  });
});
