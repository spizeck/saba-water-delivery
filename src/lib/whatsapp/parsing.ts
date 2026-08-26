/**
 * Pure, deterministic input parsing for the WhatsApp conversation — no
 * AI/intent classification (see DEVIN.md "Do Not Implement AI Chat").
 * Every parser here recognizes a narrow, explicit set of replies and
 * returns `null` for anything else so the caller can re-prompt.
 */

import type { VulnerableCircumstance } from "@/lib/domain/types";
import { isValidSabaVillage, SABA_VILLAGES, type SabaVillage } from "@/lib/domain/villages";

const GREETING_WORDS = ["hi", "hello", "hey", "water", "start", "menu", "request water"];

export function isGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return GREETING_WORDS.includes(normalized);
}

/** Parses a single numbered menu choice, e.g. "1" -> 1. Returns null for anything else. */
export function parseMenuNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function isConfirmKeyword(text: string): boolean {
  return text.trim().toUpperCase() === "CONFIRM";
}

export function isCancelKeyword(text: string): boolean {
  return text.trim().toUpperCase() === "CANCEL";
}

/** Numbered village menu text, using the canonical SABA_VILLAGES order. */
export function villageMenuText(): string {
  return SABA_VILLAGES.map((v, i) => `${i + 1}. ${v}`).join("\n");
}

/** Parses a numbered village menu reply into a canonical village, or null if invalid. */
export function parseVillageChoice(text: string): SabaVillage | null {
  const num = parseMenuNumber(text);
  if (num === null || num < 1 || num > SABA_VILLAGES.length) return null;
  const village = SABA_VILLAGES[num - 1];
  return isValidSabaVillage(village) ? village : null;
}

const VULNERABLE_OPTIONS: { value: VulnerableCircumstance; label: string }[] = [
  { value: "elderly", label: "Elderly person" },
  { value: "infant_or_young_child", label: "Infant or young child" },
  { value: "medical_need", label: "Medical need" },
  { value: "essential_services_commercial_business", label: "Essential services (Commercial/business)" },
  { value: "hotel_or_restaurant", label: "Hotel or Restaurant" },
  { value: "none", label: "None" },
];

export function vulnerableCircumstanceMenuText(): string {
  return (
    VULNERABLE_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`).join("\n") +
    "\n\nReply with the numbers that apply, separated by commas (e.g. 1,3), or 6 for None."
  );
}

/**
 * Parses a comma-separated numbered multi-select reply (e.g. "1,3" or
 * "6") into canonical vulnerable-circumstance values. Returns null if
 * the reply contains no valid selections. "None" (6) is exclusive —
 * combining it with other selections just drops the others, matching
 * the web form's "None of these" checkbox behavior.
 */
export function parseVulnerableCircumstances(text: string): VulnerableCircumstance[] | null {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const selected: VulnerableCircumstance[] = [];
  for (const part of parts) {
    const num = parseMenuNumber(part);
    if (num === null || num < 1 || num > VULNERABLE_OPTIONS.length) return null;
    selected.push(VULNERABLE_OPTIONS[num - 1].value);
  }

  if (selected.includes("none")) return ["none"];
  return selected;
}

/** Parses the quantity/load menu choice ("1" or "2"). */
export function parseLoadsChoice(text: string): 1 | 2 | null {
  const num = parseMenuNumber(text);
  if (num === 1) return 1;
  if (num === 2) return 2;
  return null;
}

/** Parses the Normal/Critical urgency menu choice ("1" or "2"). */
export function parseUrgencyChoice(text: string): "normal" | "critical" | null {
  const num = parseMenuNumber(text);
  if (num === 1) return "normal";
  if (num === 2) return "critical";
  return null;
}

/** Parses a non-negative integer for "persons affected", or "skip"/blank for none. */
export function parsePersonsAffected(text: string): { value: number | null } | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "" || trimmed === "skip" || trimmed === "0") return { value: null };
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? { value } : null;
}

/** Parses free text for "available storage", or "skip"/blank for none. */
export function parseAvailableStorage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toLowerCase() === "skip") return null;
  return trimmed;
}
