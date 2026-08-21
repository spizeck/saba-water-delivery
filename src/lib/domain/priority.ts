/**
 * Centralized dispatch-priority domain logic.
 *
 * See PRODUCT.md "Additional Water Request Information" / "Initial
 * Priority Rules" and TECHNICAL.md "Dispatch Priority" for the full
 * policy this module implements.
 *
 * Design goals (deliberately simple, not a scoring model):
 *   - A single, documented function decides the INITIAL priority of a
 *     new request from structured answers only.
 *   - The resident-facing form only offers Normal/Critical (see
 *     `ReportedUrgency` in types.ts) — "Urgent" is no longer a resident
 *     choice, following government testing feedback that it caused
 *     subjective debate. A resident can still reach an initial Critical
 *     priority, but only by also providing a required written
 *     explanation (`WaterSituationSnapshot.criticalExplanation`,
 *     enforced in `waterRequests.ts`), which is a meaningfully stronger
 *     signal than a bare urgency radio button — so, unlike the previous
 *     policy, a validated Critical self-report is no longer capped at
 *     Urgent.
 *   - `"urgent"` remains a fully valid `DispatchPriority` value — it is
 *     just no longer something the SYSTEM assigns automatically from a
 *     resident's own report. Government staff can still assign or
 *     escalate any request to Urgent through the existing dispatcher
 *     override (`changeRequestPriority`).
 *   - Government staff can always see and override the result (see
 *     `changeRequestPriority` in waterRequests.ts) with a required
 *     reason, which is audited.
 *   - Ordering by priority must remain simple and explainable: within
 *     a priority level, the oldest request always wins (see
 *     `priorityRankFor`, used to sort Firestore queries numerically
 *     since "critical" < "urgent" < "normal" alphabetically does NOT
 *     match the desired dispatch order).
 */

import type { DispatchPriority, ReportedUrgency, VulnerableCircumstance } from "./types";

// ---------------------------------------------------------------------------
// Priority ranking (for Firestore ordering)
// ---------------------------------------------------------------------------

/**
 * Numeric rank used ONLY to sort Firestore queries by priority (lower
 * rank = higher priority = offered/shown first). Alphabetical order of
 * the string values ("critical", "normal", "urgent") does not match the
 * intended critical > urgent > normal ordering, so a denormalized
 * numeric `priorityRank` field is stored alongside `dispatchPriority` on
 * every request and kept in sync whenever priority changes.
 */
export const PRIORITY_RANK: Record<DispatchPriority, number> = {
  critical: 0,
  urgent: 1,
  normal: 2,
};

export function priorityRankFor(priority: DispatchPriority): number {
  return PRIORITY_RANK[priority];
}

export function isValidDispatchPriority(value: unknown): value is DispatchPriority {
  return value === "normal" || value === "urgent" || value === "critical";
}

// ---------------------------------------------------------------------------
// Initial priority determination
// ---------------------------------------------------------------------------

export interface WaterSituationForPriority {
  /** May be empty (treated the same as ["none"]) if nothing was selected. */
  vulnerableCircumstances: VulnerableCircumstance[];
  /** The resident's own characterization of urgency. */
  reportedUrgency: ReportedUrgency;
}

export interface PriorityDetermination {
  priority: DispatchPriority;
  reason: string;
}

/**
 * Centralized, documented V1 rule for the INITIAL dispatch priority of a
 * new water request (see PRODUCT.md "Initial Priority Rules"). This is
 * a short, explainable decision tree — not a scoring algorithm — so any
 * staff member can be told exactly why a request received a given
 * priority.
 *
 * Rules, applied in order:
 *   1. CRITICAL — the resident reports a vulnerable-person or critical
 *      circumstance (elderly, infant or young child, medical need,
 *      essential services (commercial/business), or hotel/restaurant).
 *   2. CRITICAL — the resident self-reported "Critical" urgency. This
 *      is only reachable with a required written explanation (validated
 *      in `waterRequests.ts` before this function is ever called), so a
 *      bare, casual self-report cannot reach this branch.
 *   3. NORMAL — everything else ("Normal" self-report and no vulnerable
 *      or critical circumstance).
 *
 * "Urgent" is deliberately never assigned here — see the module-level
 * doc comment above. It remains fully valid as a `DispatchPriority`
 * that dispatcher/admin staff may assign via `changeRequestPriority`.
 */
export function determineInitialDispatchPriority(
  waterSituation: WaterSituationForPriority,
): PriorityDetermination {
  const hasVulnerableCircumstance = waterSituation.vulnerableCircumstances.some(
    (c) => c !== "none",
  );

  if (hasVulnerableCircumstance) {
    return {
      priority: "critical",
      reason: "Resident reported a vulnerable-person or critical circumstance.",
    };
  }

  if (waterSituation.reportedUrgency === "critical") {
    return {
      priority: "critical",
      reason: 'Resident self-reported "Critical" urgency with a required explanation.',
    };
  }

  return { priority: "normal", reason: "No critical indicators reported." };
}
