/**
 * Centralized dispatch-priority domain logic.
 *
 * See PRODUCT.md "Additional Water Request Information" / "Do Not
 * Blindly Trust Self-Declared Priority" / "Initial Priority Rules" and
 * TECHNICAL.md "Dispatch Priority" for the full policy this module
 * implements.
 *
 * Design goals (deliberately simple, not a scoring model):
 *   - A single, documented function decides the INITIAL priority of a
 *     new request from structured answers only.
 *   - The resident's own self-reported urgency is one input, but never
 *     by itself produces the highest priority — a resident selecting
 *     "Critical" must not be an unrestricted queue-jump mechanism.
 *   - Government staff can always see and override the result (see
 *     `changeRequestPriority` in waterRequests.ts) with a required
 *     reason, which is audited.
 *   - Ordering by priority must remain simple and explainable: within
 *     a priority level, the oldest request always wins (see
 *     `priorityRankFor`, used to sort Firestore queries numerically
 *     since "critical" < "urgent" < "normal" alphabetically does NOT
 *     match the desired dispatch order).
 */

import type {
  DispatchPriority,
  ReportedUrgency,
  VulnerableCircumstance,
  WaterSituationRemainingSupply,
} from "./types";

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
  remainingSupply: WaterSituationRemainingSupply;
  vulnerableCircumstances: VulnerableCircumstance[];
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
 *   1. CRITICAL — the resident reports being out of water, OR reported
 *      any vulnerable-person/critical circumstance (elderly, infant or
 *      young child, medical need, essential service, or another
 *      critical circumstance).
 *   2. URGENT — remaining supply is estimated at less than 1 day, or at
 *      1-2 days.
 *   3. URGENT (not CRITICAL) — the resident self-reported "Critical"
 *      urgency but none of the above structured, corroborating answers
 *      were given. A bare self-report is capped at Urgent so it cannot
 *      alone create an unrestricted queue-jump; dispatcher/admin staff
 *      can review and escalate to Critical if warranted.
 *   4. NORMAL — everything else (more than 2 days remaining, or
 *      unsure, with no vulnerable circumstance and no critical
 *      self-report).
 */
export function determineInitialDispatchPriority(
  waterSituation: WaterSituationForPriority,
): PriorityDetermination {
  const hasVulnerableCircumstance = waterSituation.vulnerableCircumstances.some(
    (c) => c !== "none",
  );

  if (waterSituation.remainingSupply === "out") {
    return { priority: "critical", reason: "Resident reports being out of water." };
  }
  if (hasVulnerableCircumstance) {
    return {
      priority: "critical",
      reason: "Resident reported a vulnerable-person or critical circumstance.",
    };
  }
  if (waterSituation.remainingSupply === "less_than_1_day") {
    return {
      priority: "urgent",
      reason: "Resident reports less than 1 day of water remaining.",
    };
  }
  if (waterSituation.remainingSupply === "1_to_2_days") {
    return { priority: "urgent", reason: "Resident reports 1-2 days of water remaining." };
  }
  if (waterSituation.reportedUrgency === "critical") {
    return {
      priority: "urgent",
      reason:
        'Resident self-reported "Critical" urgency without a corroborating structured answer (out of water / vulnerable circumstance / under 1 day remaining); treated as Urgent pending staff review.',
    };
  }
  return { priority: "normal", reason: "No urgent or critical indicators reported." };
}
