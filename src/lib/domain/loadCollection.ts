/**
 * Pure domain helpers for water load collection logic. These are shared
 * between server-side domain functions and client UI components, so this
 * module must NOT import "server-only" or use any Firestore/admin
 * dependencies.
 */

import type { WaterLoadCollection } from "./types";
import type { RequestedLoads } from "./quantity";

/**
 * Checks whether all required load collections have been recorded.
 * Returns true if delivery can proceed.
 */
export function areAllLoadsCollected(
  loads: RequestedLoads,
  loadCollections: WaterLoadCollection[] | null,
): boolean {
  const collections = loadCollections ?? [];
  return collections.length >= loads;
}

/**
 * Returns which load numbers still need collection.
 */
export function getMissingLoadNumbers(
  loads: RequestedLoads,
  loadCollections: WaterLoadCollection[] | null,
): Array<1 | 2> {
  const collections = loadCollections ?? [];
  const collectedNumbers = new Set(collections.map((lc) => lc.loadNumber));
  const missing: Array<1 | 2> = [];
  for (let i = 1; i <= loads; i++) {
    if (!collectedNumbers.has(i as 1 | 2)) {
      missing.push(i as 1 | 2);
    }
  }
  return missing;
}
