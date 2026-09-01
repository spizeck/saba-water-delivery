import { describe, expect, it } from "vitest";

import { getDeclineResultMessage, isDailyCooldown } from "@/lib/utils/declineResult";

describe("decline result messaging", () => {
  it("returns the 'still eligible' message when no cooldown is applied", () => {
    const message = getDeclineResultMessage({ state: "available", cooldownUntil: null });
    expect(message).toBe("Load declined. Another offer will appear when available.");
  });

  it("returns the short-cooldown message with the configured return time", () => {
    // Saba is UTC-4; 3:42 PM Saba == 19:42Z. Same day.
    const cooldownUntil = new Date("2026-08-20T19:42:00.000Z");
    const message = getDeclineResultMessage({ state: "cooldown", cooldownUntil });
    expect(message).toMatch(/You have reached the decline limit/);
    expect(message).toMatch(/3:42 PM/);
  });

  it("returns the daily-limit message when the cooldown runs past the end of today", () => {
    const cooldownUntil = new Date("2026-08-21T06:00:00.000Z");
    const message = getDeclineResultMessage({ state: "daily_limit", cooldownUntil });
    expect(message).toMatch(/today[’']s decline limit/);
    expect(message).toMatch(/rest of the day/);
    expect(message).toMatch(/Aug 21, 2026/);
  });
});

describe("isDailyCooldown", () => {
  it("returns false for a cooldown that expires later today", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const cooldownUntil = new Date("2026-08-20T19:42:00.000Z");
    expect(isDailyCooldown(cooldownUntil, now)).toBe(false);
  });

  it("returns true for a cooldown that expires tomorrow", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const cooldownUntil = new Date("2026-08-21T06:00:00.000Z");
    expect(isDailyCooldown(cooldownUntil, now)).toBe(true);
  });
});
