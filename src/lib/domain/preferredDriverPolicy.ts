import type { DispatchPriority, WaterRequestStatus } from "./types";

export interface PreferredDriverHoldDecisionInput {
  preferredDriverId: string | null | undefined;
  dispatchPriority: DispatchPriority;
  preferredDriverImmediatelyAvailable: boolean;
  now: Date;
  windowHours: number;
}

export interface PreferredDriverHoldDecision {
  willHold: boolean;
  status: Extract<WaterRequestStatus, "preferred_driver_hold" | "available">;
  expiresAt: Date | null;
  bypassedForPriority: boolean;
}

/**
 * Applies the preferred-driver policy without depending on Firestore.
 * Normal-priority requests always receive the configured exclusive
 * window. Urgent/critical requests receive it only when the preferred
 * driver is immediately available.
 */
export function decidePreferredDriverHold(
  input: PreferredDriverHoldDecisionInput,
): PreferredDriverHoldDecision {
  const {
    preferredDriverId,
    dispatchPriority,
    preferredDriverImmediatelyAvailable,
    now,
    windowHours,
  } = input;
  const hasPreferredDriver = Boolean(preferredDriverId);
  const bypassedForPriority =
    hasPreferredDriver && dispatchPriority !== "normal" && !preferredDriverImmediatelyAvailable;
  const willHold = hasPreferredDriver && !bypassedForPriority;

  return {
    willHold,
    status: willHold ? "preferred_driver_hold" : "available",
    expiresAt: willHold ? new Date(now.getTime() + windowHours * 60 * 60 * 1000) : null,
    bypassedForPriority,
  };
}

/** The hold releases at the exact expiry instant, not one tick later. */
export function isPreferredDriverHoldExpired(
  expiresAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!expiresAt) return false;
  const expiryTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime <= now.getTime();
}
