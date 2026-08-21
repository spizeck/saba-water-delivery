import "server-only";

/**
 * Server-only wrapper around the pure phone-matching logic — fetches
 * the resident directory (the same one dispatcher search already uses)
 * and delegates to `matchResidentByPhoneFromDirectory()`. See
 * PRODUCT.md "Resident Identity Strategy".
 */

import { getResidentDirectory } from "@/lib/domain/users";

import { matchResidentByPhoneFromDirectory, type ResidentPhoneMatch } from "./phoneMatching";

export type { ResidentPhoneMatch } from "./phoneMatching";

export async function matchResidentByPhone(rawPhone: string): Promise<ResidentPhoneMatch> {
  const directory = await getResidentDirectory();
  return matchResidentByPhoneFromDirectory(rawPhone, directory);
}
