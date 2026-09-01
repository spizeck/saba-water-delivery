import { formatSabaDate, formatSabaTime, startOfSabaDay } from "./datetime";

export type DeclineResultState = "available" | "cooldown" | "daily_limit";

export interface DeclineResultSummary {
  state: DeclineResultState;
  cooldownUntil: Date | null;
}

/** Whether a cooldown extends to or past the end of the current Saba day. */
export function isDailyCooldown(cooldownUntil: Date, now = new Date()): boolean {
  const endOfToday = startOfSabaDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return cooldownUntil.getTime() >= endOfToday.getTime();
}

/** Returns the driver-facing message for a decline result. */
export function getDeclineResultMessage(summary: DeclineResultSummary): string {
  if (summary.state === "available") {
    return "Load declined. Another offer will appear when available.";
  }
  if (summary.state === "daily_limit" && summary.cooldownUntil) {
    const date = formatSabaDate(summary.cooldownUntil);
    return `You have reached today’s decline limit and are offline for the rest of the day. You can receive offers again on ${date}.`;
  }
  if (summary.state === "cooldown" && summary.cooldownUntil) {
    const time = formatSabaTime(summary.cooldownUntil);
    return `You have reached the decline limit. You are offline until ${time}.`;
  }
  return "Offer declined.";
}
