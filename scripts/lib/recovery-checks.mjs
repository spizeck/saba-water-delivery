/**
 * Pure, read-only cross-document consistency checks.
 *
 * These functions take plain arrays of Firestore document data and return a
 * flat list of findings. They NEVER read Firestore, never mutate anything, and
 * contain no secrets or personal data — findings carry only opaque document
 * IDs (Firestore doc ids / Firebase uids) and a short categorical reason. This
 * module is the SINGLE SOURCE OF TRUTH for the lifecycle/consistency rules,
 * imported by:
 *   - the disaster-recovery validator `scripts/verify-recovery.mjs` (issue #35),
 *     which runs the `runRecoveryChecks` subset; and
 *   - the read-only production integrity diagnostic
 *     `scripts/production-integrity.mjs` (issue #52), which runs the fuller
 *     `runIntegrityChecks` set.
 * Both consume the same pure check functions here, so the overlapping rules can
 * never drift into two implementations.
 *
 * Finding shape: `{ severity, category, code, id, relatedIds?, detail }`.
 *   - `severity`: "critical" | "warning" | "info"
 *   - `category`: stable human grouping (kept unchanged for the checks the DR
 *      validator has always emitted, so its tests/output are unaffected)
 *   - `code`: dotted machine-readable reason
 *   - `id`: the primary opaque record id the finding is about
 *   - `relatedIds`: other opaque ids involved (optional)
 *   - `detail`: short operator-facing string — opaque ids only, never PII
 *
 * The `classifyDriverLock` rule mirrors `checkActiveRequestValidity` in
 * `src/lib/domain/activeRequestValidation.ts` (the runtime self-healing rule):
 * a driver's `activeRequestId` is valid only when the referenced request
 * exists, is `claimed`, and is assigned to that same driver. It is kept as a
 * small standalone copy so this operator tooling has no build step and no
 * dependency on the application's TypeScript modules; if the canonical rule
 * changes, update both. A regression test
 * (`scripts/lib/__tests__/activeRequestRuleParity.test.ts`) imports both and
 * fails if they diverge, so the duplication cannot drift silently. Likewise the
 * batch-status rule below mirrors `computeDispatchBatchStatus`. See
 * docs/DISASTER_RECOVERY.md and docs/OPERATIONS.md.
 */

/**
 * @typedef {"critical" | "warning" | "info"} Severity
 * @typedef {{
 *   severity: Severity,
 *   category: string,
 *   code: string,
 *   id: string,
 *   relatedIds?: string[],
 *   detail: string,
 * }} IntegrityFinding
 */

const SEVERITY_ORDER = ["critical", "warning", "info"];

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

/**
 * Derives a batch's operational status ("active"/"completed") from its CURRENT
 * member statuses. Mirrors `computeDispatchBatchStatus` in
 * `src/lib/domain/dispatchBatchSelection.ts` (a run is "active" while any
 * current member is still "claimed"). Kept standalone for the no-build-step
 * operator tooling; a parity test pins the two together.
 */
export function deriveBatchStatus(memberStatuses) {
  return memberStatuses.some((s) => s === "claimed") ? "active" : "completed";
}

// ---------------------------------------------------------------------------
// Individual checks (each pure; each returns IntegrityFinding[])
// ---------------------------------------------------------------------------

/**
 * Driver registry entries whose `activeRequestId` lock is stale.
 *
 * @param unresolvedRequestIds request ids that were referenced but NOT scanned
 *   because a bounded scan exhausted its budget. A lock pointing at such an id
 *   is skipped (not classified as `request_missing`): the diagnostic must never
 *   turn "not scanned" into "missing". Defaults to empty (the DR validator and
 *   full scans resolve every referenced request, so nothing is skipped).
 */
export function findStaleDriverLocks(
  drivers,
  requestsById,
  unresolvedRequestIds = new Set(),
) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const driver of drivers) {
    if (!driver.activeRequestId) continue;
    // Not scanned due to the record budget — cannot be classified as missing.
    if (unresolvedRequestIds.has(driver.activeRequestId)) continue;
    const reason = classifyDriverLock(
      driver.linkedUserId ?? null,
      requestsById.get(driver.activeRequestId),
    );
    if (reason) {
      findings.push({
        // Stale locks are self-healing: reconcileActiveRequest clears them on
        // the next offer/availability read, so they are surfaced as warnings,
        // not live-contradiction criticals.
        severity: "warning",
        category: "stale_driver_lock",
        code: `stale_driver_lock.${reason}`,
        id: driver.id,
        relatedIds: [driver.activeRequestId],
        detail: `activeRequestId=${driver.activeRequestId} reason=${reason}`,
      });
    }
  }
  return findings;
}

/**
 * Claimed requests whose driver assignment is inconsistent: no
 * `assignedDriverId`, an `assignedDriverId` with no matching (non-archived)
 * driver registry entry, or a NON-batch claimed request whose driver's
 * `activeRequestId` does not point back to it.
 *
 * The back-pointer check is skipped for batch (Delivery Run) loads on purpose:
 * `createDispatchBatch()` deliberately leaves `driverRegistry.activeRequestId`
 * unchanged so a driver can hold several batch loads at once (the documented
 * exception to the one-active-request lock — ADR 0008 / TECHNICAL.md "Batch
 * Dispatch"). Requiring the back-pointer there would flag every valid batch.
 */
export function findClaimedRequestDriverMismatches(requests, driversByUserId) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const request of requests) {
    if (request.status !== "claimed") continue;

    if (!request.assignedDriverId) {
      findings.push({
        severity: "critical",
        category: "claimed_request_driver_mismatch",
        code: "claimed_ownership.no_driver",
        id: request.id,
        detail: "claimed request has no assignedDriverId",
      });
      continue;
    }

    const driver = driversByUserId.get(request.assignedDriverId);
    if (!driver) {
      findings.push({
        severity: "critical",
        category: "claimed_request_driver_mismatch",
        code: "claimed_ownership.driver_registry_missing",
        id: request.id,
        relatedIds: [request.assignedDriverId],
        detail: "assignedDriverId has no linked driver registry entry",
      });
      continue;
    }
    if (driver.archivedAt) {
      findings.push({
        severity: "critical",
        category: "claimed_request_driver_mismatch",
        code: "claimed_ownership.driver_archived",
        id: request.id,
        relatedIds: [driver.id],
        detail: "assigned driver registry entry is archived",
      });
      continue;
    }
    // Batch loads intentionally do not set the driver's single-active-request
    // lock, so only require the back-pointer for non-batch claimed requests.
    if (!request.dispatchBatchId && driver.activeRequestId !== request.id) {
      findings.push({
        // The assignment itself is correct; the lock just does not point back
        // and is reconciled lazily, so this is a warning, not a critical.
        severity: "warning",
        category: "claimed_request_driver_mismatch",
        code: "claimed_ownership.active_request_id_mismatch",
        id: request.id,
        relatedIds: [driver.id],
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
  unresolvedRequestIds = new Set(),
) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const batch of batches) {
    for (const requestId of batch.originalRequestIds ?? []) {
      // Not scanned due to the record budget — absence here is unknown, not
      // proven missing, so it must not become a false finding.
      if (unresolvedRequestIds.has(requestId)) continue;
      if (!requestsById.has(requestId)) {
        findings.push({
          severity: "warning",
          category: "batch_missing_request",
          code: "batch_membership.original_request_missing",
          id: batch.id,
          relatedIds: [requestId],
          detail: `originalRequestIds references missing request ${requestId}`,
        });
      }
    }
  }
  for (const request of requests) {
    if (request.dispatchBatchId && !batchesById.has(request.dispatchBatchId)) {
      findings.push({
        severity: "warning",
        category: "request_batch_missing",
        code: "batch_membership.batch_missing",
        id: request.id,
        relatedIds: [request.dispatchBatchId],
        detail: `dispatchBatchId references missing batch ${request.dispatchBatchId}`,
      });
    }
  }
  return findings;
}

/**
 * Registered requests (a non-null `customerId`) whose owning `users/{uid}`
 * document is missing — a resident/request ownership break. Intentionally
 * unregistered/manual requests (`customerId == null`) are NOT flagged.
 */
export function findOrphanedRequestOwners(requests, usersById) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const request of requests) {
    if (request.customerId && !usersById.has(request.customerId)) {
      findings.push({
        severity: "warning",
        category: "orphaned_request_owner",
        code: "resident_ownership.user_missing",
        id: request.id,
        relatedIds: [request.customerId],
        detail: `customerId=${request.customerId} has no users/{uid} document`,
      });
    }
  }
  return findings;
}

/**
 * Two-way Delivery-run membership/driver integrity, beyond simple existence
 * (which `findBatchMembershipIssues` covers). Current membership is a request's
 * `dispatchBatchId` pointing at the batch; `originalRequestIds` is the
 * immutable original assignment (a member that LEFT the run keeps its slot in
 * `originalRequestIds` but has its `dispatchBatchId` cleared — ADR 0008 — so a
 * request in `originalRequestIds` that no longer points back is NOT flagged).
 *
 * Flags, for a request whose `dispatchBatchId` points at an existing batch (a
 * CURRENT member):
 *   - the batch's `originalRequestIds` does not include it (a request can only
 *     acquire `dispatchBatchId` via `createDispatchBatch`, which always adds it
 *     to `originalRequestIds`, so this is an impossible two-way contradiction);
 *   - the batch has no `driverId`, or the member has no `assignedDriverId`, or
 *     the two disagree. Verified against the domain code (not just ADR wording):
 *     `createDispatchBatch()` sets `batch.driverId` and every member's
 *     `assignedDriverId` to the SAME uid and never nulls `batch.driverId`; the
 *     only transitions that clear a request's `assignedDriverId`
 *     (reassign-to-another-driver, cancel, dispute-reopen — see
 *     `waterRequests.ts`) also clear its `dispatchBatchId`. So a CURRENT member
 *     always has both driver fields set and equal — any null or divergent value
 *     is an impossible, delivery-misdirecting state and is critical.
 * And per batch, a status cache that disagrees with its current members.
 *
 * @param unresolvedRequestIds request ids referenced but NOT scanned due to a
 *   bounded scan's budget. A batch with any such member is skipped for the
 *   status-drift derivation, since its live member set cannot be fully known
 *   (again: never turn "not scanned" into a finding). Defaults to empty.
 */
export function findBatchOwnershipInconsistencies(
  batches,
  requests,
  batchesById,
  unresolvedRequestIds = new Set(),
) {
  /** @type {IntegrityFinding[]} */
  const findings = [];

  // Current members grouped by batch id (live membership = dispatchBatchId).
  /** @type {Map<string, Record<string, unknown>[]>} */
  const currentMembersByBatch = new Map();
  for (const request of requests) {
    const batchId = request.dispatchBatchId;
    if (!batchId || !batchesById.has(batchId)) continue; // dangling handled elsewhere
    const batch = batchesById.get(batchId);

    const originalIds = batch.originalRequestIds ?? [];
    if (!originalIds.includes(request.id)) {
      findings.push({
        severity: "critical",
        category: "batch_member_not_in_original",
        code: "batch_ownership.member_not_in_original",
        id: request.id,
        relatedIds: [batchId],
        detail: `request points at batch ${batchId} but is absent from its originalRequestIds`,
      });
    }
    // A current member must be assigned to the run's driver, with both fields
    // present and equal (see the domain-verified invariant above). Distinguish
    // the three broken forms so operators know which side is wrong.
    if (
      batch.driverId == null ||
      request.assignedDriverId == null ||
      request.assignedDriverId !== batch.driverId
    ) {
      const reason =
        batch.driverId == null
          ? "batch_missing_driver"
          : request.assignedDriverId == null
            ? "member_missing_driver"
            : "driver_mismatch";
      findings.push({
        severity: "critical",
        category: "batch_member_driver_mismatch",
        code: `batch_ownership.${reason}`,
        id: request.id,
        relatedIds: [batchId],
        detail:
          reason === "batch_missing_driver"
            ? `current member points at batch ${batchId} which has no driverId`
            : reason === "member_missing_driver"
              ? `current member of batch ${batchId} has no assignedDriverId`
              : `batch member assignedDriverId differs from the run's driverId (batch ${batchId})`,
      });
    }

    if (!currentMembersByBatch.has(batchId))
      currentMembersByBatch.set(batchId, []);
    currentMembersByBatch.get(batchId).push(request);
  }

  // Batch status cache vs. derived status from current members.
  for (const batch of batches) {
    if (batch.status !== "active" && batch.status !== "completed") continue;
    // If any member was left unscanned by the budget, the live member set is
    // unknown — do not derive (and possibly mis-report) a status drift.
    if (
      (batch.originalRequestIds ?? []).some((id) =>
        unresolvedRequestIds.has(id),
      )
    )
      continue;
    const members = currentMembersByBatch.get(batch.id) ?? [];
    const derived = deriveBatchStatus(members.map((m) => m.status));
    if (batch.status !== derived) {
      findings.push({
        // Status is a maintained cache (ADR 0008) that transitions are meant to
        // keep in sync; a mismatch can be transient during concurrent writes,
        // so it is a warning cleanup signal, not a live contradiction.
        severity: "warning",
        category: "batch_status_drift",
        code: `batch_status.${batch.status}_but_derived_${derived}`,
        id: batch.id,
        detail: `batch.status=${batch.status} but current members derive ${derived}`,
      });
    }
  }

  return findings;
}

/**
 * Preferred-driver references that cannot be honored, scoped to requests still
 * ACTIVELY holding for a preferred driver (`preferred_driver_hold`). A
 * preferred driver being merely offline or temporarily ineligible is a VALID
 * operational state (the hold waits or is released lazily) and is NOT flagged.
 */
export function findPreferredDriverIssues(requests, driversByUserId) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const request of requests) {
    if (request.status !== "preferred_driver_hold") continue;
    if (!request.preferredDriverId) continue;
    const driver = driversByUserId.get(request.preferredDriverId);
    if (!driver) {
      findings.push({
        severity: "warning",
        category: "preferred_driver_missing_registry",
        code: "preferred_driver.no_registry",
        id: request.id,
        relatedIds: [request.preferredDriverId],
        detail: `preferred_driver_hold references preferredDriverId with no driver registry entry`,
      });
      continue;
    }
    if (driver.archivedAt) {
      findings.push({
        severity: "warning",
        category: "preferred_driver_archived",
        code: "preferred_driver.archived",
        id: request.id,
        relatedIds: [driver.id],
        detail: `preferred_driver_hold references an archived driver registry entry`,
      });
    }
  }
  return findings;
}

/**
 * User role ↔ Driver Registry linkage integrity. Linking a driver account adds
 * the `driver` role and sets `linkedUserId`; unlinking removes both; a user is
 * linked to at most one registry entry (`linkDriverAccount` enforces this).
 * `eligibilityStatus` is deliberately NOT coupled to role existence here.
 *
 * @param drivers all driver registry entries (archived included)
 * @param users all user docs (need `roles`)
 * @param usersById map uid -> user doc
 */
export function findRoleRegistryInconsistencies(drivers, users, usersById) {
  /** @type {IntegrityFinding[]} */
  const findings = [];

  // Registry -> user direction, plus duplicate-link detection.
  /** @type {Map<string, string[]>} liveLinked: linkedUserId -> [registry ids] */
  const liveLinked = new Map();
  for (const driver of drivers) {
    const linkedUserId = driver.linkedUserId ?? null;
    if (!linkedUserId) continue;

    if (!driver.archivedAt) {
      if (!liveLinked.has(linkedUserId)) liveLinked.set(linkedUserId, []);
      liveLinked.get(linkedUserId).push(driver.id);
    }

    const user = usersById.get(linkedUserId);
    if (!user) {
      findings.push({
        severity: "warning",
        category: "role_registry_linked_user_missing",
        code: "role_registry.linked_user_missing",
        id: driver.id,
        relatedIds: [linkedUserId],
        detail: `registry linkedUserId=${linkedUserId} has no users/{uid} document`,
      });
      continue;
    }
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes("driver")) {
      findings.push({
        severity: "warning",
        category: "role_registry_missing_driver_role",
        code: "role_registry.linked_user_missing_driver_role",
        id: driver.id,
        relatedIds: [linkedUserId],
        detail: `registry is linked to a user that lacks the "driver" role`,
      });
    }
  }

  for (const [linkedUserId, registryIds] of liveLinked) {
    if (registryIds.length > 1) {
      findings.push({
        severity: "warning",
        category: "role_registry_duplicate_link",
        code: "role_registry.duplicate_link",
        id: linkedUserId,
        relatedIds: registryIds,
        detail: `user is linked by ${registryIds.length} live driver registry entries`,
      });
    }
  }

  // User -> registry direction: a `driver` role with no linking registry entry
  // (archived or not). A user linked only to an archived registry entry is
  // still considered linked (archiving neither unlinks nor removes the role).
  const linkedUserIds = new Set(
    drivers.filter((d) => d.linkedUserId).map((d) => d.linkedUserId),
  );
  for (const user of users) {
    const uid = user.uid ?? user.id;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (roles.includes("driver") && !linkedUserIds.has(uid)) {
      findings.push({
        severity: "warning",
        category: "role_registry_driver_role_without_registry",
        code: "role_registry.driver_role_without_registry",
        id: uid,
        detail: `user has the "driver" role but no linked driver registry entry`,
      });
    }
  }

  return findings;
}

/**
 * Impossible/stale request-state field combinations that the lifecycle should
 * never produce (distinct from the stale-lock and batch checks above):
 *   - a pre-claim request (requested / preferred_driver_hold / available) that
 *     still carries an `assignedDriverId` (claiming sets it; requeue/reopen
 *     clears it);
 *   - a `cancelled` request that still carries a `dispatchBatchId` (cancelling
 *     a batch member clears its membership).
 * Terminal states still holding an active driver lock are covered by
 * `findStaleDriverLocks`; delivered/confirmed/disputed batch members keeping
 * their `dispatchBatchId` is VALID (the run stays a complete record).
 */
export function findRequestStateInconsistencies(requests) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  const preClaim = new Set(["requested", "preferred_driver_hold", "available"]);
  for (const request of requests) {
    if (preClaim.has(request.status) && request.assignedDriverId) {
      findings.push({
        severity: "warning",
        category: "request_state_preclaim_assignment",
        code: "request_state.preclaim_with_assignment",
        id: request.id,
        relatedIds: [request.assignedDriverId],
        detail: `status=${request.status} still carries assignedDriverId`,
      });
    }
    if (request.status === "cancelled" && request.dispatchBatchId) {
      findings.push({
        severity: "warning",
        category: "request_state_cancelled_with_batch",
        code: "request_state.cancelled_with_batch",
        id: request.id,
        relatedIds: [request.dispatchBatchId],
        detail: `cancelled request still carries dispatchBatchId`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Account-merge Auth reconciliation (issue #73)
// ---------------------------------------------------------------------------

/** Milliseconds after creation when unresolved reconciliation work is stale. */
export const MERGE_RECONCILIATION_STALE_MS = 24 * 60 * 60_000;

/** Best-effort epoch-ms coercion for Timestamp-like objects, numbers, or ISO
 * strings. Returns null when unparseable. */
function toMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return null;
}

/**
 * Account-merge Auth-reconciliation integrity (issue #73). READ-ONLY: surfaces
 * unresolved/terminal/stale work and impossible field combinations; repair is
 * the reconciliation worker's job, never this diagnostic's.
 *
 * Unresolved means `duplicateAuthDeleted !== true` — which deliberately also
 * covers legacy merge records that predate the `authReconciliation`
 * sub-record. A freshly merged record being briefly `pending` is normal and
 * NOT flagged; only stale unresolved work, terminal failures, stale leases,
 * and inconsistent terminal combinations are reported.
 */
export function findMergeReconciliationIssues(mergeEvents, nowMs = Date.now()) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const event of mergeEvents) {
    const rec =
      event.authReconciliation && typeof event.authReconciliation === "object"
        ? event.authReconciliation
        : null;
    const state = rec?.state ?? null;
    const resolved = event.duplicateAuthDeleted === true;

    // Malformed record: missing/empty/equal uids can never be reconciled.
    const canonical = event.canonicalUserId;
    const duplicate = event.duplicateUserId;
    if (
      typeof canonical !== "string" ||
      canonical.length === 0 ||
      typeof duplicate !== "string" ||
      duplicate.length === 0 ||
      canonical === duplicate
    ) {
      findings.push({
        severity: "critical",
        category: "merge_reconciliation_malformed",
        code: "merge_reconciliation.malformed_record",
        id: event.id,
        detail: `merge record lacks valid canonical/duplicate uids`,
      });
      continue;
    }

    // Inconsistent terminal combinations.
    if (resolved && state !== null && state !== "reconciled") {
      findings.push({
        severity: "warning",
        category: "merge_reconciliation_inconsistent",
        code: "merge_reconciliation.deleted_flag_without_reconciled_state",
        id: event.id,
        detail: `duplicateAuthDeleted=true but authReconciliation.state=${state}`,
      });
      continue;
    }
    if (!resolved && state === "reconciled") {
      findings.push({
        // The reconciler re-verifies and heals this combination; it is not a
        // live contradiction, just a record that has not converged yet.
        severity: "warning",
        category: "merge_reconciliation_inconsistent",
        code: "merge_reconciliation.reconciled_state_without_deleted_flag",
        id: event.id,
        detail: `authReconciliation.state=reconciled but duplicateAuthDeleted is not true`,
      });
      continue;
    }
    if (resolved) continue; // consistent + resolved → nothing to report

    // Unresolved work below here.
    if (state === "failed") {
      findings.push({
        severity: "warning",
        category: "merge_reconciliation_terminal_failure",
        code: "merge_reconciliation.terminal_failure",
        id: event.id,
        relatedIds: [canonical, duplicate],
        detail: `terminal failure category=${rec?.lastFailureCategory ?? event.error ?? "unknown"}`,
      });
      continue;
    }
    const leaseExpiresMs = toMs(rec?.leaseExpiresAt);
    if (
      state === "processing" &&
      leaseExpiresMs !== null &&
      leaseExpiresMs <= nowMs
    ) {
      findings.push({
        // Reclaimed automatically by the sweep — informational.
        severity: "info",
        category: "merge_reconciliation_stale_lease",
        code: "merge_reconciliation.stale_lease",
        id: event.id,
        detail: `processing lease expired; sweep will reclaim`,
      });
    }
    const createdMs = toMs(event.createdAt);
    const lastAttemptMs = toMs(rec?.lastAttemptAt);
    const activityMs = lastAttemptMs ?? createdMs;
    if (
      activityMs !== null &&
      nowMs - activityMs > MERGE_RECONCILIATION_STALE_MS
    ) {
      findings.push({
        severity: "warning",
        category: "merge_reconciliation_stale",
        code: "merge_reconciliation.unresolved_stale",
        id: event.id,
        relatedIds: [canonical, duplicate],
        detail: `unresolved (state=${state ?? "legacy-pending"}) for more than ${Math.round(MERGE_RECONCILIATION_STALE_MS / 3_600_000)}h`,
      });
    }
  }
  return findings;
}

/**
 * Merged-away identity marker integrity (issue #73): a `users` doc marked
 * `mergedIntoUserId` must point at an existing canonical user, and a live
 * water request must never still be owned by a merged-away identity (the
 * merge transaction relinks them — a leftover means a missed relink or a
 * post-merge write to a dead identity).
 */
export function findMergedIdentityIssues(users, requests, usersById) {
  /** @type {IntegrityFinding[]} */
  const findings = [];
  for (const user of users) {
    const uid = user.uid ?? user.id;
    const mergedInto = user.mergedIntoUserId;
    if (!mergedInto) continue;
    if (!usersById.has(mergedInto)) {
      findings.push({
        severity: "warning",
        category: "merge_marker_canonical_missing",
        code: "merge_marker.canonical_missing",
        id: uid,
        relatedIds: [mergedInto],
        detail: `mergedIntoUserId=${mergedInto} has no users/{uid} document`,
      });
    }
  }
  for (const request of requests) {
    if (!request.customerId) continue;
    const owner = usersById.get(request.customerId);
    if (owner && owner.mergedIntoUserId) {
      findings.push({
        severity: "warning",
        category: "merge_marker_request_owned_by_merged_user",
        code: "merge_marker.request_owned_by_merged_user",
        id: request.id,
        relatedIds: [request.customerId, owner.mergedIntoUserId],
        detail: `customerId=${request.customerId} is a merged-away identity`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Shared index builders + summary
// ---------------------------------------------------------------------------

function buildIndexes({ drivers, requests, batches, users }) {
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const batchesById = new Map(batches.map((b) => [b.id, b]));
  const usersById = new Map(users.map((u) => [u.uid ?? u.id, u]));
  // Last-wins on duplicate linkedUserId; duplicate detection is handled
  // explicitly in findRoleRegistryInconsistencies.
  const driversByUserId = new Map(
    drivers.filter((d) => d.linkedUserId).map((d) => [d.linkedUserId, d]),
  );
  return { requestsById, batchesById, usersById, driversByUserId };
}

function summarize(findings, counts) {
  /** @type {Record<string, number>} */
  const byCategory = {};
  /** @type {Record<string, number>} */
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) {
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  return { total: findings.length, byCategory, bySeverity, counts };
}

/**
 * Disaster-recovery check subset (issue #35). Unchanged set of checks so the DR
 * validator's behavior and tests are unaffected; findings now also carry
 * `severity`/`code` (additive).
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
  const { requestsById, batchesById, usersById, driversByUserId } =
    buildIndexes({ drivers, requests, batches, users });

  const findings = [
    ...findStaleDriverLocks(drivers, requestsById),
    ...findClaimedRequestDriverMismatches(requests, driversByUserId),
    ...findBatchMembershipIssues(batches, requests, requestsById, batchesById),
    ...findOrphanedRequestOwners(requests, usersById),
  ];

  return {
    findings,
    summary: summarize(findings, {
      drivers: drivers.length,
      requests: requests.length,
      batches: batches.length,
      users: users.length,
    }),
  };
}

/**
 * Full production integrity check set (issue #52): the DR subset PLUS two-way
 * batch ownership/driver/status, preferred-driver, role↔registry, and
 * request-state invariants. Composes the SAME pure check functions as
 * `runRecoveryChecks` for the overlapping rules — one source of truth.
 *
 * @param {{
 *   drivers?: Record<string, unknown>[],
 *   requests?: Record<string, unknown>[],
 *   batches?: Record<string, unknown>[],
 *   users?: Record<string, unknown>[],
 *   mergeEvents?: Record<string, unknown>[],
 * }} input
 * @param {{ unresolvedRequestIds?: Iterable<string>, nowMs?: number }} [options]
 *   `unresolvedRequestIds` are request ids referenced by a loaded driver/batch
 *   that a bounded scan did NOT read because its record budget was exhausted.
 *   Checks that infer a "missing" reference skip these ids, so a truncated
 *   scan can never report "not scanned" as "missing". Defaults to none.
 *   `nowMs` is the epoch-ms "now" for stale-merge-reconciliation detection.
 */
export function runIntegrityChecks(
  { drivers = [], requests = [], batches = [], users = [], mergeEvents = [] },
  options = {},
) {
  const { requestsById, batchesById, usersById, driversByUserId } =
    buildIndexes({ drivers, requests, batches, users });
  const unresolvedRequestIds = new Set(options.unresolvedRequestIds ?? []);

  const findings = [
    ...findStaleDriverLocks(drivers, requestsById, unresolvedRequestIds),
    ...findClaimedRequestDriverMismatches(requests, driversByUserId),
    ...findBatchMembershipIssues(
      batches,
      requests,
      requestsById,
      batchesById,
      unresolvedRequestIds,
    ),
    ...findOrphanedRequestOwners(requests, usersById),
    ...findBatchOwnershipInconsistencies(
      batches,
      requests,
      batchesById,
      unresolvedRequestIds,
    ),
    ...findPreferredDriverIssues(requests, driversByUserId),
    ...findRoleRegistryInconsistencies(drivers, users, usersById),
    ...findRequestStateInconsistencies(requests),
    ...findMergeReconciliationIssues(mergeEvents, options.nowMs),
    ...findMergedIdentityIssues(users, requests, usersById),
  ];

  // Deterministic ordering: severity (critical→warning→info), then category,
  // then id — so operators and tests can reason about the output.
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.category.localeCompare(b.category) ||
      String(a.id).localeCompare(String(b.id)),
  );

  return {
    findings,
    summary: summarize(findings, {
      drivers: drivers.length,
      requests: requests.length,
      batches: batches.length,
      users: users.length,
    }),
  };
}
