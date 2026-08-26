/**
 * Canonical water-quantity model.
 *
 * A request is always for either 1 or 2 1,000-gallon loads. The server
 * derives `gallons` from `loads`; clients never supply an authoritative
 * gallon value.
 */

export type RequestedLoads = 1 | 2;
export type StandardLoadGallons = 1000 | 2000;

export const LOAD_GALLONS = 1000 as const;

export function isValidRequestedLoads(value: unknown): value is RequestedLoads {
  return value === 1 || value === 2;
}

export function parseRequestedLoads(value: unknown): RequestedLoads | null {
  const numeric = typeof value === "string" ? parseInt(value, 10) : value;
  if (numeric === 1 || numeric === 2) return numeric;
  return null;
}

export function gallonsForLoads(loads: RequestedLoads): StandardLoadGallons {
  return (loads * LOAD_GALLONS) as StandardLoadGallons;
}

export function formatWaterQuantity(loads: RequestedLoads): string {
  const gallonCount = gallonsForLoads(loads);
  const loadWord = loads === 1 ? "load" : "loads";
  return `${loads} ${loadWord} (${gallonCount.toLocaleString("en-US")} gallons)`;
}
