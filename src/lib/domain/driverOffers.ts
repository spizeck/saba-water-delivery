import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { sabaCalendarDateKey } from "@/lib/utils/datetime";

import type { DriverOfferResponse } from "./types";

/**
 * Domain/service layer for the driver dispatch-decision ledger
 * (`driverOffers` collection).
 *
 * A `driverOffers/{offerId}` document records one dispatch decision about
 * a single (request, driver) pair. Records are append-only: a decline or
 * expiration never overwrites or deletes a prior record, it is always a
 * fresh document. This preserves full assignment/decline history for
 * auditing and statistics (see TECHNICAL.md "Dispatch Assignment").
 *
 * Since issue #123 there are no pending offers: a record is created only
 * AFTER `claimWaterRequest()` has atomically assigned the request, and it
 * is born resolved (`"assigned"`). Selection and assignment are a single
 * atomic step — showing a delivery to a driver and assigning it are the
 * same operation. The atomic claim transaction remains the sole
 * authority over whether an assignment succeeds.
 */
const DRIVER_OFFERS_COLLECTION = "driverOffers";

// ---------------------------------------------------------------------------
// Dispatch records
// ---------------------------------------------------------------------------

/**
 * Builds the document payload for a dispatch record that is already
 * resolved at creation. Written inside the caller's transaction so the
 * ledger entry commits atomically with the state change it describes —
 * `"assigned"` inside the claim transaction, `"declined"` inside the
 * release transaction.
 */
export function buildDispatchRecord(
  driverId: string,
  requestId: string,
  response: "assigned" | "declined",
): Record<string, unknown> {
  return {
    requestId,
    driverId,
    offeredAt: FieldValue.serverTimestamp(),
    response,
    respondedAt: FieldValue.serverTimestamp(),
  };
}

export function driverOffersCollection(db: Firestore) {
  return db.collection(DRIVER_OFFERS_COLLECTION);
}

/**
 * Resolves an offer record in place (system expiration of a legacy
 * pending offer). Internal: new records are born resolved via
 * `buildDispatchRecord` — only legacy pending records are ever resolved
 * after creation.
 */
async function recordOfferResponse(
  offerId: string,
  response: Exclude<DriverOfferResponse, null>,
): Promise<void> {
  const db = getAdminDb();
  await db.collection(DRIVER_OFFERS_COLLECTION).doc(offerId).update({
    response,
    respondedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Expires every pending (`response == null`) offer record for a driver.
 *
 * Pending offers are a legacy concept — before issue #123 an offer was
 * displayed before the request was claimed. Any that survive deployment
 * must never again be treated as meaningful: expiring them here is the
 * idempotent deployment reconciliation. Runs unconditionally on each
 * assignment pass so a pending offer can never resurrect the old
 * "displayed but not assigned" state.
 */
export async function expirePendingOffersForDriver(
  driverId: string,
): Promise<number> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(DRIVER_OFFERS_COLLECTION)
    .where("driverId", "==", driverId)
    .where("response", "==", null)
    .orderBy("offeredAt", "desc")
    .get();

  if (snapshot.empty) return 0;
  await Promise.all(
    snapshot.docs.map((doc) => recordOfferResponse(doc.id, "expired")),
  );
  return snapshot.size;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns the set of request IDs this driver has declined within the
 * recent dispatch window.
 *
 * Declining/releasing an assignment is meant to give other eligible
 * drivers the first opportunity on that specific request, not to
 * permanently blacklist the request for the declining driver. Historical
 * decline records remain in `driverOffers` for audit/statistics, but only
 * recent declines affect future assignments. The default lookback is 24
 * hours.
 */
export async function getDeclinedRequestIdsForDriver(
  driverId: string,
  since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000),
): Promise<Set<string>> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(DRIVER_OFFERS_COLLECTION)
    .where("driverId", "==", driverId)
    .where("response", "==", "declined")
    .where("respondedAt", ">=", since)
    .orderBy("respondedAt", "desc")
    .get();

  return new Set(snapshot.docs.map((doc) => doc.data().requestId as string));
}

/**
 * Counts how many dispatch decisions this driver has declined during the
 * current Saba-local operational day (see src/lib/utils/datetime.ts).
 *
 * Implementation note: we bound the Firestore query with a generous
 * 26-hour lookback (covers any timezone offset safely) and then filter
 * precisely by comparing formatted local calendar dates. This avoids
 * having to compute an exact UTC instant for "local midnight" here, and
 * remains correct even if the operational timezone ever changes to one
 * with DST (see `sabaCalendarDateKey`).
 */
export async function countDeclinesToday(driverId: string): Promise<number> {
  const db = getAdminDb();
  const lookback = new Date(Date.now() - 26 * 60 * 60 * 1000);

  const snapshot = await db
    .collection(DRIVER_OFFERS_COLLECTION)
    .where("driverId", "==", driverId)
    .where("response", "==", "declined")
    .where("respondedAt", ">=", lookback)
    .get();

  const todayKey = sabaCalendarDateKey(new Date());

  return snapshot.docs.filter((doc) => {
    const respondedAt = doc.data().respondedAt?.toDate?.();
    return (
      respondedAt instanceof Date &&
      sabaCalendarDateKey(respondedAt) === todayKey
    );
  }).length;
}

/**
 * Returns aggregate dispatch-decision counts across all drivers for the
 * statistics dashboard. Reads are unbounded by driver but bounded by
 * period at the call site (see src/lib/domain/statistics.ts).
 *
 * `accepted` counts only legacy explicit-accept records; current
 * assignments are `"assigned"`. `pending` counts surviving legacy
 * unanswered offers — always zero under normal post-#123 operation.
 */
export interface OfferAggregate {
  offered: number;
  assigned: number;
  accepted: number;
  declined: number;
  expired: number;
  pending: number;
}

export async function getOfferAggregate(
  periodStart: Date | null,
): Promise<OfferAggregate> {
  const db = getAdminDb();
  let query = db.collection(
    DRIVER_OFFERS_COLLECTION,
  ) as FirebaseFirestore.Query;
  if (periodStart) {
    query = query.where("offeredAt", ">=", periodStart);
  }
  const snapshot = await query.get();

  const aggregate: OfferAggregate = {
    offered: 0,
    assigned: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
    pending: 0,
  };
  for (const doc of snapshot.docs) {
    aggregate.offered++;
    const response = doc.data().response as DriverOfferResponse;
    if (response === "assigned") aggregate.assigned++;
    else if (response === "accepted") aggregate.accepted++;
    else if (response === "declined") aggregate.declined++;
    else if (response === "expired") aggregate.expired++;
    else aggregate.pending++;
  }
  return aggregate;
}
