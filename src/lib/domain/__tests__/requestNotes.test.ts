import { describe, expect, it } from "vitest";

import { normalizeRequestNotes, REQUEST_NOTES_MAX_LENGTH } from "../requestNotes";

describe("request notes", () => {
  it("accepts an absent note", () => {
    expect(normalizeRequestNotes(undefined)).toBeNull();
    expect(normalizeRequestNotes("")).toBeNull();
  });

  it("trims and accepts a valid note", () => {
    expect(normalizeRequestNotes("  Please call at the gate.  ")).toBe(
      "Please call at the gate.",
    );
  });

  it("accepts the maximum length", () => {
    expect(normalizeRequestNotes("a".repeat(REQUEST_NOTES_MAX_LENGTH))).toHaveLength(
      REQUEST_NOTES_MAX_LENGTH,
    );
  });

  it("rejects an over-limit note", () => {
    expect(() => normalizeRequestNotes("a".repeat(REQUEST_NOTES_MAX_LENGTH + 1))).toThrow(
      "REQUEST_NOTES_TOO_LONG",
    );
  });
});
