import { describe, expect, it } from "vitest";

import {
  formatWaterQuantity,
  gallonsForLoads,
  isValidRequestedLoads,
  parseRequestedLoads,
} from "@/lib/domain/quantity";

describe("quantity helpers", () => {
  it("accepts 1 or 2 loads", () => {
    expect(isValidRequestedLoads(1)).toBe(true);
    expect(isValidRequestedLoads(2)).toBe(true);
  });

  it("rejects anything other than 1 or 2 loads", () => {
    expect(isValidRequestedLoads(0)).toBe(false);
    expect(isValidRequestedLoads(3)).toBe(false);
    expect(isValidRequestedLoads(null)).toBe(false);
    expect(isValidRequestedLoads(undefined)).toBe(false);
    expect(isValidRequestedLoads("1")).toBe(false);
  });

  it("parses numeric and string 1 or 2", () => {
    expect(parseRequestedLoads("1")).toBe(1);
    expect(parseRequestedLoads("2")).toBe(2);
    expect(parseRequestedLoads(1)).toBe(1);
    expect(parseRequestedLoads(2)).toBe(2);
  });

  it("returns null for invalid load strings/values", () => {
    expect(parseRequestedLoads("0")).toBeNull();
    expect(parseRequestedLoads("3")).toBeNull();
    expect(parseRequestedLoads("one")).toBeNull();
    expect(parseRequestedLoads(null)).toBeNull();
  });

  it("derives 1000 gallons from one load", () => {
    expect(gallonsForLoads(1)).toBe(1000);
  });

  it("derives 2000 gallons from two loads", () => {
    expect(gallonsForLoads(2)).toBe(2000);
  });

  it("formats one load", () => {
    expect(formatWaterQuantity(1)).toBe("1 load (1,000 gallons)");
  });

  it("formats two loads", () => {
    expect(formatWaterQuantity(2)).toBe("2 loads (2,000 gallons)");
  });
});
