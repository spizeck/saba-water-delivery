/**
 * Pure resolved/active partitioning for the dispatcher request list —
 * deliberately factored out of `RequestList.tsx` so the ordering can be
 * unit tested directly, same pattern as `deriveDriverWorkloads.ts`.
 *
 * The `requests` prop arrives already sorted for the ACTIVE operational
 * queue (status group → dispatch priority → override rank →
 * `requestedAt`; see `page.tsx`). Resolved requests must NOT inherit
 * that ordering: "Recently resolved" is ordered by when each request
 * actually reached its terminal status, newest first (issue #140).
 */

import type { WaterRequest, WaterRequestStatus } from "@/lib/domain/types";

/**
 * Terminal statuses shown in "Recently resolved". `"delivered"` is
 * deliberately absent — it is still active work awaiting customer
 * confirmation (see PRODUCT.md "Delivery Confirmation"). `"disputed"`
 * likewise remains active until staff resolve it.
 */
export const RESOLVED_STATUSES: WaterRequestStatus[] = [
  "confirmed",
  "cancelled",
];

export const RECENT_RESOLVED_LIMIT = 20;

/**
 * The canonical time a request was resolved: `confirmedAt` for
 * `"confirmed"` (written by every confirmation path — resident, staff,
 * auto-timeout, dispute-resolved) and `cancelledAt` for `"cancelled"`
 * (written by both staff and resident cancellation).
 *
 * Returns `null` — resolution time unknown — when the canonical field
 * is absent or unparseable. Deliberately NO fallback to `updatedAt`
 * (admin customer-history relinks and account merges still bump it on
 * resolved documents, so a recently relinked legacy cancellation would
 * impersonate a fresh resolution and displace genuinely recent records)
 * and never `requestedAt` (request age is not resolution time).
 */
function resolvedAtMs(request: WaterRequest): number | null {
  const iso =
    request.status === "cancelled" ? request.cancelledAt : request.confirmedAt;
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The up-to-`limit` most recently resolved requests, newest resolution
 * first. Records with a known canonical resolution time always rank
 * ahead of legacy/malformed records whose resolution time is unknown;
 * unknown-time records stay visible but can never outrank a genuinely
 * recent resolution. `id` is the deterministic tie-breaker in both
 * groups. Does not mutate or depend on the input ordering.
 */
export function selectRecentResolved(
  requests: WaterRequest[],
  limit: number = RECENT_RESOLVED_LIMIT,
): WaterRequest[] {
  return requests
    .filter((r) => RESOLVED_STATUSES.includes(r.status))
    .sort((a, b) => {
      const aMs = resolvedAtMs(a);
      const bMs = resolvedAtMs(b);
      if (aMs === null && bMs === null) return a.id.localeCompare(b.id);
      if (aMs === null) return 1;
      if (bMs === null) return -1;
      return bMs - aMs || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

/**
 * Active (unresolved) requests in the caller's existing order — the
 * operational queue ordering produced by `page.tsx` is preserved
 * exactly, only the resolved records are filtered out.
 */
export function selectActiveRequests(requests: WaterRequest[]): WaterRequest[] {
  return requests.filter((r) => !RESOLVED_STATUSES.includes(r.status));
}
