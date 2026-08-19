import { describe, expect, it } from "vitest";

import {
  formatSabaDate,
  formatSabaDateTime,
  formatSabaTime,
  sabaCalendarDateKey,
  startOfSabaDay,
  startOfSabaMonth,
  startOfSabaYear,
} from "@/lib/utils/datetime";

/**
 * These tests verify the Saba timezone helpers format and compute calendar
 * boundaries correctly. They run in Node and rely on the Intl timezone
 * database containing America/Puerto_Rico.
 */

describe("datetime", () => {
  // 2026-01-15 14:30:00 UTC = 2026-01-15 10:30:00 AST (UTC-4)
  const instant = new Date(Date.UTC(2026, 0, 15, 14, 30, 0));

  it("formatSabaDate formats in Puerto Rico time", () => {
    const formatted = formatSabaDate(instant);
    expect(formatted).toMatch(/Jan 15, 2026/);
  });

  it("formatSabaTime formats in Puerto Rico time", () => {
    const formatted = formatSabaTime(instant);
    expect(formatted).toMatch(/10:30/);
  });

  it("formatSabaDateTime formats in Puerto Rico time", () => {
    const formatted = formatSabaDateTime(instant);
    expect(formatted).toMatch(/Jan 15, 2026/);
    expect(formatted).toMatch(/10:30/);
  });

  it("sabaCalendarDateKey returns YYYY-MM-DD in Puerto Rico time", () => {
    expect(sabaCalendarDateKey(instant)).toBe("2026-01-15");
  });

  it("calendar key changes at Puerto Rico midnight, not UTC midnight", () => {
    // 2026-01-16 03:00 UTC = 2026-01-15 23:00 AST (still same Saba day)
    const justBeforeMidnightSaba = new Date(Date.UTC(2026, 0, 16, 3, 0, 0));
    expect(sabaCalendarDateKey(justBeforeMidnightSaba)).toBe("2026-01-15");

    // 2026-01-16 05:00 UTC = 2026-01-16 01:00 AST (next Saba day)
    const justAfterMidnightSaba = new Date(Date.UTC(2026, 0, 16, 5, 0, 0));
    expect(sabaCalendarDateKey(justAfterMidnightSaba)).toBe("2026-01-16");
  });

  it("startOfSabaDay returns the Saba midnight UTC instant", () => {
    const start = startOfSabaDay(instant);
    // Saba midnight Jan 15 = 2026-01-15 04:00 UTC (because Saba is UTC-4)
    const expected = new Date(Date.UTC(2026, 0, 15, 4, 0, 0));
    expect(start.toISOString()).toBe(expected.toISOString());
  });

  it("startOfSabaMonth returns the start of the Saba month", () => {
    const start = startOfSabaMonth(instant);
    const expected = new Date(Date.UTC(2026, 0, 1, 4, 0, 0));
    expect(start.toISOString()).toBe(expected.toISOString());
  });

  it("startOfSabaYear returns the start of the Saba year", () => {
    const start = startOfSabaYear(instant);
    const expected = new Date(Date.UTC(2026, 0, 1, 4, 0, 0));
    expect(start.toISOString()).toBe(expected.toISOString());
  });

  it("sabaCalendarDateKey returns correct date around local midnight", () => {
    // 2026-06-15 23:30 AST = 2026-06-16 03:30 UTC
    // 2026-06-15 00:30 AST = 2026-06-15 04:30 UTC
    const beforeMidnight = new Date(Date.UTC(2026, 5, 16, 3, 30, 0));
    const afterMidnight = new Date(Date.UTC(2026, 5, 15, 4, 30, 0));
    expect(sabaCalendarDateKey(beforeMidnight)).toBe("2026-06-15");
    expect(sabaCalendarDateKey(afterMidnight)).toBe("2026-06-15");
  });
});
