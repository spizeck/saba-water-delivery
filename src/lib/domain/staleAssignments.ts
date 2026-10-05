import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { getLogger, serializeError } from "@/lib/logging";
import { processInBatches } from "@/lib/utils/processInBatches";

import { appConfig } from "./config";

/**
 * Stale-assignment sweep (issue #135) — automatically releases ordinary
 * `claimed` deliveries whose CURRENT assignment has been open for at
 * least `appConfig.staleAssignmentReleaseHours` (12h) without delivery.
 *
 * Why this exists: issue #123 made displayed deliveries immediately
 * assigned, intentionally surviving browser closes and navigation. The
 * flip side is that a driver who simply never acts would hold a
 * delivery hostage forever — no driver action, no cron, nothing. This
 * sweep is the system recovery path that returns such assignments to
 * the dispatch queue.
 *
 * Authoritative timestamp: `waterRequests.claimedAt` — the time the
 * CURRENT assignment began. Every assignment path writes it
 * (automatic claim, dispatcher assignment, reassignment, batch
 * assignment) and every release/requeue clears it, so reassignment
 * always starts a fresh 12-hour window. `requestedAt`, offer
 * timestamps, and acknowledgement times are never consulted.
 *
 * Safety model — the scan only IDENTIFIES candidates; each release is
 * decided inside its own transaction that re-reads committed state and
 * requires ALL of:
 *   - request still `claimed`        (not delivered/cancelled/reopened)
 *   - same `assignedDriverId`        (not reassigned to another driver)
 *   - same `claimedAt`               (same assignment — a reassignment,
 *     even to the same driver, writes a new claimedAt and gets a new
 *     window)
 *   - claimedAt still older than the threshold at commit time
 *   - no `dispatchBatchId`           (Delivery Runs are staff-managed)
 *   - no recorded `loadCollections`  (collected water is never stranded)
 *
 * A stale sweep run racing a delivery, cancellation, or reassignment
 * therefore can never release work it did not validate — at worst it
 * no-ops on the stale candidate.
 *
 * Deliberately NOT decline accounting: this is a system recovery action,
 * not a driver choice. No `driverOffers` "declined" record is written,
 * the daily decline count is untouched, and no cooldown can start. The
 * audit trail distinguishes it via `assignment_auto_released` events
 * (request + driver registry) rather than `driver_released`.
 *
 * Missing/corrupt `claimedAt` on a `claimed` document is an anomaly:
 * the request is NOT released on guesswork — it is counted in
 * `missingClaimedAt` for operational follow-up.
 */

const REQUESTS_COLLECTION = "waterRequests";
const REGISTRY_COLLECTION = "driverRegistry";

/** Maximum claimed requests examined per sweep run — bounds the scan. */
const MAX_SWEEP_SCAN = 500;
/** Concurrent release transactions per sweep batch. */
const SWEEP_CONCURRENCY = 10;

export interface StaleAssignmentSweepResult {
  /** Claimed requests examined (after scan bound). */
  scanned: number;
  /** Claimed requests at/past the assignment-age threshold. */
  candidates: number;
  /** Requests actually released back to dispatch. */
  released: number;
  /**
   * Candidates skipped because committed state no longer matched the
   * scanned snapshot (delivered, cancelled, reassigned, newer claimedAt)
   * or was no longer safe to release. All benign/idempotent.
   */
  skippedStale: number;
  /** Claimed requests with a missing/invalid `claimedAt` — anomalies. */
  missingClaimedAt: number;
  /** Scan hit the bound — a follow-up run will pick up the remainder. */
  truncated: boolean;
  /** Per-candidate failures (transaction errors), logged individually. */
  failed: number;
}

type ReleaseOutcome = "released" | "skipped_stale" | "skipped_not_releasable";

/**
 * Atomically release `requestId` if committed state still shows the
 * exact assignment the scan judged stale — same driver AND same
 * `claimedAt` — and it is still past the threshold and safe to release.
 * Any mismatch is a no-op.
 *
 * Exported (rather than module-private) so emulator tests can exercise
 * the stale-candidate race deterministically: scan, mutate committed
 * state, then release.
 */
export async function releaseStaleAssignmentIfUnchanged(
  requestId: string,
  expectedDriverId: string,
  expectedClaimedAtMs: number,
  now: Date,
): Promise<ReleaseOutcome> {
  const db = getAdminDb();
  const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const cutoffMs =
    now.getTime() - appConfig.staleAssignmentReleaseHours * 60 * 60 * 1000;

  return db.runTransaction<ReleaseOutcome>(async (txn) => {
    const snap = await txn.get(requestRef);
    if (!snap.exists) return "skipped_stale";
    const data = snap.data()!;

    // Assignment-identity revalidation: everything below must describe
    // the SAME assignment the scan saw, not just any stale-looking doc.
    if (data.status !== "claimed") return "skipped_stale";
    if (data.assignedDriverId !== expectedDriverId) return "skipped_stale";
    const claimedAt = data.claimedAt?.toDate?.();
    if (
      !(claimedAt instanceof Date) ||
      claimedAt.getTime() !== expectedClaimedAtMs ||
      claimedAt.getTime() > cutoffMs
    ) {
      return "skipped_stale";
    }
    if (data.dispatchBatchId) return "skipped_not_releasable";
    if (
      Array.isArray(data.loadCollections) &&
      data.loadCollections.length > 0
    ) {
      return "skipped_not_releasable";
    }

    const registrySnap = await txn.get(
      db
        .collection(REGISTRY_COLLECTION)
        .where("linkedUserId", "==", expectedDriverId)
        .limit(1),
    );

    // ---- All writes after reads ----
    const nowField = FieldValue.serverTimestamp();

    // Same queue-return semantics as releaseAssignedDelivery —
    // requestedAt/priority preserved, preferred-driver hold cleared.
    txn.update(requestRef, {
      status: "available",
      assignedDriverId: null,
      claimedAt: null,
      availableAt: nowField,
      preferredDriverId: null,
      preferredDriverExpiresAt: null,
      updatedAt: nowField,
    });

    if (!registrySnap.empty) {
      const registryRef = registrySnap.docs[0].ref;
      const registryData = registrySnap.docs[0].data();
      // Clear the active-delivery lock only if it points at this request
      // (same convention as markWaterDelivered / releaseAssignedDelivery).
      if (registryData.activeRequestId === requestId) {
        txn.update(registryRef, {
          activeRequestId: null,
          updatedAt: nowField,
          updatedBy: "system",
        });
      }
      // Driver-history visibility that a held assignment timed out —
      // distinct from a driver-initiated release.
      txn.set(registryRef.collection("events").doc(), {
        type: "assignment_auto_released",
        actorId: "system",
        actorRole: "system",
        createdAt: nowField,
        metadata: {
          requestId,
          claimedAt: claimedAt.toISOString(),
          thresholdHours: appConfig.staleAssignmentReleaseHours,
        },
      });
    }

    txn.set(requestRef.collection("events").doc(), {
      type: "assignment_auto_released",
      // System action — no human actor (same convention as
      // preferred_driver_expired).
      actorId: null,
      actorRole: null,
      createdAt: nowField,
      metadata: {
        driverId: expectedDriverId,
        claimedAt: claimedAt.toISOString(),
        thresholdHours: appConfig.staleAssignmentReleaseHours,
      },
    });

    return "released";
  });
}

/**
 * Scans `claimed` requests and releases every assignment older than
 * `appConfig.staleAssignmentReleaseHours` that is still safe to release.
 *
 * Server-authoritative, idempotent, and safe under missed/overlapping
 * runs: candidates are identified from a bounded scan but each release
 * re-validates committed state in its own transaction, so a second run
 * (or an overlapping scheduler tick) finds nothing left to do.
 *
 * `now` is injectable for deterministic tests.
 */
export async function releaseStaleAssignments(
  now: Date = new Date(),
): Promise<StaleAssignmentSweepResult> {
  const db = getAdminDb();
  const log = getLogger("stale-assignment-sweep");
  const cutoffMs =
    now.getTime() - appConfig.staleAssignmentReleaseHours * 60 * 60 * 1000;

  // Broad, index-free scan: claimed requests are operationally few (one
  // per working driver), so a bounded equality scan + in-memory age
  // filter is cheaper and simpler than a dedicated composite index.
  const claimedSnap = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "claimed")
    .limit(MAX_SWEEP_SCAN)
    .get();

  const result: StaleAssignmentSweepResult = {
    scanned: claimedSnap.size,
    candidates: 0,
    released: 0,
    skippedStale: 0,
    missingClaimedAt: 0,
    truncated: claimedSnap.size === MAX_SWEEP_SCAN,
    failed: 0,
  };

  const candidates: {
    id: string;
    driverId: string;
    claimedAtMs: number;
  }[] = [];

  for (const doc of claimedSnap.docs) {
    const data = doc.data();
    const claimedAt = data.claimedAt?.toDate?.();
    if (!(claimedAt instanceof Date)) {
      result.missingClaimedAt += 1;
      continue;
    }
    if (claimedAt.getTime() > cutoffMs) continue;
    if (typeof data.assignedDriverId !== "string") {
      // Claimed with no assignee is anomalous — never release on it.
      result.missingClaimedAt += 1;
      continue;
    }
    candidates.push({
      id: doc.id,
      driverId: data.assignedDriverId,
      claimedAtMs: claimedAt.getTime(),
    });
  }
  result.candidates = candidates.length;

  await processInBatches(candidates, SWEEP_CONCURRENCY, async (candidate) => {
    try {
      const outcome = await releaseStaleAssignmentIfUnchanged(
        candidate.id,
        candidate.driverId,
        candidate.claimedAtMs,
        now,
      );
      if (outcome === "released") {
        result.released += 1;
      } else {
        // Both stale-state and not-releasable outcomes are benign:
        // committed state no longer matched the candidate snapshot.
        result.skippedStale += 1;
      }
    } catch (error) {
      result.failed += 1;
      log.error("stale_assignment_release_failed", {
        requestId: candidate.id,
        driverId: candidate.driverId,
        ...serializeError(error),
      });
    }
  });

  return result;
}
