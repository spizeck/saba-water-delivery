/**
 * Pure, read-only cross-document consistency checks for disaster-recovery
 * validation (issue #35).
 *
 * These functions take plain arrays of Firestore document data and return a
 * flat list of findings. They NEVER read Firestore, never mutate anything, and
 * contain no secrets or personal data — findings carry only opaque document
 * IDs and a short categorical reason. This module is the single source of the
 * check logic, imported by both the operator script (`scripts/verify-recovery.mjs`)
 * and its Vitest tests.
 *
 * The `classifyDriverLock` rule mirrors `checkActiveRequestValidity` in
 * `src/lib/domain/activeRequestValidation.ts` (the runtime self-healing rule):
 * a driver's `activeRequestId` is valid only when the referenced request
 * exists, is `claimed`, and is assigned to that same driver. Kept as a small
 * standalone copy so this operator tooling has no build step and no dependency
 * on the application's TypeScript modules; if the canonical rule changes, update
 * both. See docs/DISASTER_RECOVERY.md.
 */

/** @typedef {{ category: string, id: string, detail: string }} RecoveryFinding */

/**
 * Classifies a driver's `activeRequestId` lock. Returns null when valid, or a
 * short reason string when stale. `request` is the referenced request's data,
 * or null/undefined when the request document does not exist.
 */
export function classifyDriverLock(driverLinkedUserId, request) {
  if (!request) return "request_missing";
  if (request.assignedDriverId !== driverLinkedUserId) return "reassigned";
  switch (request.status) {
    case "claimed":
      return null; // valid
    case "delivered":
      return "delivered";
    case "confirmed":
      return "confirmed";
    case "cancelled":
      return "cancelled";
    case "disputed":
      return "disputed";
    default:
      return "not_active";
  }
}

/** Driver registry entries whose `activeRequestId` lock is stale. */
export function findStaleDriverLocks(drivers, requestsById) {
  /** @type {RecoveryFinding[]} */
  const findings = [];
  for (const driver of drivers) {
    if (!driver.activeRequestId) continue;
    const reason = classifyDriverLock(
      driver.linkedUserId ?? null,
      requestsById.get(driver.activeRequestId),
    );
    if (reason) {
      findings.push({
        category: "stale_driver_lock",
        id: driver.id,
        detail: `activeRequestId=${driver.activeRequestId} reason=${reason}`,
      });
    }
  }
  return findings;
}

/**
 * Claimed requests whose driver assignment is inconsistent: no
 * `assignedDriverId`, an `assignedDriverId` with no matching (non-archived)
 * driver registry entry, or a driver whose `activeRequestId` does not point
 * back to the request it is claimed for.
 */
export function findClaimedRequestDriverMismatches(requests, driversByUserId) {
  /** @type {RecoveryFinding[]} */
  const findings = [];
  for (const request of requests) {
    if (request.status !== "claimed") continue;

    if (!request.assignedDriverId) {
      findings.push({
        category: "claimed_request_driver_mismatch",
        id: request.id,
        detail: "claimed request has no assignedDriverId",
      });
      continue;
    }

    const driver = driversByUserId.get(request.assignedDriverId);
    if (!driver) {
      findings.push({
        category: "claimed_request_driver_mismatch",
        id: request.id,
        detail: "assignedDriverId has no linked driver registry entry",
      });
      continue;
    }
    if (driver.archivedAt) {
      findings.push({
        category: "claimed_request_driver_mismatch",
        id: request.id,
        detail: "assigned driver registry entry is archived",
      });
      continue;
    }
    if (driver.activeRequestId !== request.id) {
      findings.push({
        category: "claimed_request_driver_mismatch",
        id: request.id,
        detail: "assigned driver's activeRequestId does not point back",
      });
    }
  }
  return findings;
}

/**
 * Delivery-run (batch) membership integrity: a batch's `originalRequestIds`
 * referencing a request that no longer exists, and a request whose
 * `dispatchBatchId` points at a batch that no longer exists.
 */
export function findBatchMembershipIssues(
  batches,
  requests,
  requestsById,
  batchesById,
) {
  /** @type {RecoveryFinding[]} */
  const findings = [];
  for (const batch of batches) {
    for (const requestId of batch.originalRequestIds ?? []) {
      if (!requestsById.has(requestId)) {
        findings.push({
          category: "batch_missing_request",
          id: batch.id,
          detail: `originalRequestIds references missing request ${requestId}`,
        });
      }
    }
  }
  for (const request of requests) {
    if (request.dispatchBatchId && !batchesById.has(request.dispatchBatchId)) {
      findings.push({
        category: "request_batch_missing",
        id: request.id,
        detail: `dispatchBatchId references missing batch ${request.dispatchBatchId}`,
      });
    }
  }
  return findings;
}

/**
 * Registered requests (a non-null `customerId`) whose owning `users/{uid}`
 * document is missing — a resident/request ownership break that a restore
 * should surface.
 */
export function findOrphanedRequestOwners(requests, usersById) {
  /** @type {RecoveryFinding[]} */
  const findings = [];
  for (const request of requests) {
    if (request.customerId && !usersById.has(request.customerId)) {
      findings.push({
        category: "orphaned_request_owner",
        id: request.id,
        detail: `customerId=${request.customerId} has no users/{uid} document`,
      });
    }
  }
  return findings;
}

/**
 * Runs every read-only recovery check over the supplied snapshot of collections
 * and returns the combined findings plus a per-category summary. Input arrays
 * hold only the fields the checks need; anything else is ignored.
 *
 * @param {{
 *   drivers?: Record<string, unknown>[],
 *   requests?: Record<string, unknown>[],
 *   batches?: Record<string, unknown>[],
 *   users?: Record<string, unknown>[],
 * }} input
 */
export function runRecoveryChecks({
  drivers = [],
  requests = [],
  batches = [],
  users = [],
}) {
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const batchesById = new Map(batches.map((b) => [b.id, b]));
  const usersById = new Map(users.map((u) => [u.uid ?? u.id, u]));
  const driversByUserId = new Map(
    drivers.filter((d) => d.linkedUserId).map((d) => [d.linkedUserId, d]),
  );

  const findings = [
    ...findStaleDriverLocks(drivers, requestsById),
    ...findClaimedRequestDriverMismatches(requests, driversByUserId),
    ...findBatchMembershipIssues(batches, requests, requestsById, batchesById),
    ...findOrphanedRequestOwners(requests, usersById),
  ];

  /** @type {Record<string, number>} */
  const byCategory = {};
  for (const finding of findings) {
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
  }

  return {
    findings,
    summary: {
      total: findings.length,
      byCategory,
      counts: {
        drivers: drivers.length,
        requests: requests.length,
        batches: batches.length,
        users: users.length,
      },
    },
  };
}
