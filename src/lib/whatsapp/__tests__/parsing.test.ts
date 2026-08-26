import { describe, expect, it } from "vitest";

import {
  isCancelKeyword,
  isConfirmKeyword,
  isGreeting,
  parseAvailableStorage,
  parseLoadsChoice,
  parseMenuNumber,
  parsePersonsAffected,
  parseUrgencyChoice,
  parseVillageChoice,
  parseVulnerableCircumstances,
} from "@/lib/whatsapp/parsing";

describe("isGreeting", () => {
  it("recognizes common greetings case-insensitively", () => {
    expect(isGreeting("Hi")).toBe(true);
    expect(isGreeting("hello")).toBe(true);
    expect(isGreeting("WATER")).toBe(true);
    expect(isGreeting("Request Water")).toBe(true);
  });

  it("does not treat arbitrary text as a greeting", () => {
    expect(isGreeting("asdf")).toBe(false);
    expect(isGreeting("")).toBe(false);
  });
});

describe("parseMenuNumber", () => {
  it("parses a plain integer", () => {
    expect(parseMenuNumber("1")).toBe(1);
    expect(parseMenuNumber(" 2 ")).toBe(2);
  });

  it("rejects non-numeric replies", () => {
    expect(parseMenuNumber("one")).toBeNull();
    expect(parseMenuNumber("1.5")).toBeNull();
    expect(parseMenuNumber("")).toBeNull();
  });
});

describe("isConfirmKeyword / isCancelKeyword", () => {
  it("requires the exact keyword (case-insensitive)", () => {
    expect(isConfirmKeyword("CONFIRM")).toBe(true);
    expect(isConfirmKeyword("confirm")).toBe(true);
    expect(isConfirmKeyword(" Confirm ")).toBe(true);
    expect(isConfirmKeyword("yes")).toBe(false);
    expect(isCancelKeyword("CANCEL")).toBe(true);
    expect(isCancelKeyword("no")).toBe(false);
  });
});

describe("parseVillageChoice", () => {
  it("accepts a valid canonical village menu number", () => {
    expect(parseVillageChoice("1")).toBe("St Johns");
    expect(parseVillageChoice("3")).toBe("Windwardside");
    expect(parseVillageChoice("5")).toBe("Zions Hill - Upper");
  });

  it("rejects an out-of-range or non-numeric choice", () => {
    expect(parseVillageChoice("0")).toBeNull();
    expect(parseVillageChoice("6")).toBeNull();
    expect(parseVillageChoice("Windwardside")).toBeNull();
  });
});

describe("parseVulnerableCircumstances", () => {
  it("parses a single selection", () => {
    expect(parseVulnerableCircumstances("6")).toEqual(["none"]);
    expect(parseVulnerableCircumstances("1")).toEqual(["elderly"]);
  });

  it("parses multiple comma-separated selections", () => {
    expect(parseVulnerableCircumstances("1,3")).toEqual(["elderly", "medical_need"]);
  });

  it("collapses to just none when none (6) is included with others", () => {
    expect(parseVulnerableCircumstances("1,6")).toEqual(["none"]);
  });

  it("rejects invalid input", () => {
    expect(parseVulnerableCircumstances("7")).toBeNull();
    expect(parseVulnerableCircumstances("abc")).toBeNull();
    expect(parseVulnerableCircumstances("")).toBeNull();
  });
});

describe("parseLoadsChoice", () => {
  it("maps 1/2 to one/two loads", () => {
    expect(parseLoadsChoice("1")).toBe(1);
    expect(parseLoadsChoice("2")).toBe(2);
  });

  it("rejects anything else", () => {
    expect(parseLoadsChoice("0")).toBeNull();
    expect(parseLoadsChoice("3")).toBeNull();
    expect(parseLoadsChoice("one")).toBeNull();
  });
});

describe("parseUrgencyChoice", () => {
  it("maps 1/2 to normal/critical", () => {
    expect(parseUrgencyChoice("1")).toBe("normal");
    expect(parseUrgencyChoice("2")).toBe("critical");
  });

  it("rejects anything else", () => {
    expect(parseUrgencyChoice("3")).toBeNull();
    expect(parseUrgencyChoice("critical")).toBeNull();
  });
});

describe("parsePersonsAffected", () => {
  it("accepts a positive integer", () => {
    expect(parsePersonsAffected("4")).toEqual({ value: 4 });
  });

  it("treats blank/skip/0 as no answer", () => {
    expect(parsePersonsAffected("")).toEqual({ value: null });
    expect(parsePersonsAffected("skip")).toEqual({ value: null });
    expect(parsePersonsAffected("SKIP")).toEqual({ value: null });
    expect(parsePersonsAffected("0")).toEqual({ value: null });
  });

  it("rejects non-numeric or negative input", () => {
    expect(parsePersonsAffected("four")).toBeNull();
    expect(parsePersonsAffected("-1")).toBeNull();
  });
});

describe("parseAvailableStorage", () => {
  it("returns trimmed free text", () => {
    expect(parseAvailableStorage("  About 2,000 gallons  ")).toBe("About 2,000 gallons");
  });

  it("treats blank/skip as no answer", () => {
    expect(parseAvailableStorage("")).toBeNull();
    expect(parseAvailableStorage("skip")).toBeNull();
  });
});
