/**
 * Centralized Saba-local date/time formatting and calendar-boundary
 * helpers (see TECHNICAL.md "Saba Operational Timezone").
 *
 * Firestore always stores proper absolute timestamps. This module is
 * the ONE place that knows the operational timezone
 * (`appConfig.operationalTimezone`) and is responsible for:
 *
 *   1. Formatting absolute timestamps for display in Saba local time,
 *      regardless of the server's or viewer's own timezone.
 *   2. Computing Saba-local calendar boundaries (start of day/month/year)
 *      as real, correct UTC instants — never by hard-coding a fixed
 *      "-4 hours" offset. The offset is derived from `Intl` at the
 *      instant in question, so this keeps working correctly even if the
 *      configured zone ever changes to one that observes DST.
 *
 * No "server-only" guard: this is pure date math (safe in both server
 * and client components), and rendering with an explicit `timeZone`
 * option means a viewer's browser timezone never affects the output —
 * a government user in any timezone sees genuine Saba operational time.
 *
 * Elapsed-duration displays ("2h ago", a 1-hour cooldown, a 24-hour
 * preferred-driver window, a 24-hour delivery confirmation window) are
 * NOT timezone-sensitive — they are computed as plain millisecond
 * differences and do not need anything from this module.
 */

import { appConfig } from "@/lib/domain/config";

const SABA_TZ = appConfig.operationalTimezone;

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** e.g. "Jan 5, 2026, 3:04 PM" in Saba local time. */
export function formatSabaDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: SABA_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** e.g. "Jan 5, 2026" in Saba local time. */
export function formatSabaDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: SABA_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** e.g. "3:04 PM" in Saba local time. */
export function formatSabaTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: SABA_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** YYYY-MM-DD calendar date in Saba local time — safe for map keys/comparisons. */
export function sabaCalendarDateKey(date: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SABA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

// ---------------------------------------------------------------------------
// Calendar boundaries (as real UTC instants)
// ---------------------------------------------------------------------------

interface SabaDateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

function sabaDateParts(instant: Date): SabaDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SABA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

/**
 * Minutes that Saba local time is ahead of UTC at the given instant
 * (negative for zones behind UTC, e.g. -240 for UTC-4). Derived from
 * `Intl` rather than assumed, so this is correct even for a timezone
 * that observes DST.
 */
function offsetMinutesAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SABA_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/** Returns the UTC instant corresponding to Saba-local Y/M/D 00:00:00. */
function sabaMidnightUtc(year: number, month: number, day: number): Date {
  // First guess assumes zero offset, then correct using the real offset
  // at that guess — correct for any fixed-offset zone in one pass.
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = offsetMinutesAt(guess);
  return new Date(guess.getTime() - offset * 60_000);
}

/** Start of the Saba-local calendar day containing `reference` (default now). */
export function startOfSabaDay(reference: Date = new Date()): Date {
  const { year, month, day } = sabaDateParts(reference);
  return sabaMidnightUtc(year, month, day);
}

/** Start of the Saba-local calendar month containing `reference` (default now). */
export function startOfSabaMonth(reference: Date = new Date()): Date {
  const { year, month } = sabaDateParts(reference);
  return sabaMidnightUtc(year, month, 1);
}

/** Start of the Saba-local calendar year containing `reference` (default now). */
export function startOfSabaYear(reference: Date = new Date()): Date {
  const { year } = sabaDateParts(reference);
  return sabaMidnightUtc(year, 1, 1);
}
