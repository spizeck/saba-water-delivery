import "server-only";

import { type DocumentData, FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

import { appConfig } from "./config";
import type { DriverOffer, DriverOfferResponse } from "./types";

/**
 * Domain/service layer for driver dispatch offers.
 *
 * A `driverOffers/{offerId}` document records one instance of a single
 * request being offered to a single driver. Offers are append-only: a
 * decline or expiration never overwrites or deletes a prior offer, it is
 * always a fresh document. This preserves full offer/decline history for
 * auditing and future statistics (see TECHNICAL.md "Dispatch Offers").
 *
 * Offer records are advisory bookkeeping for the one-offer-at-a-time UX
 * and the decline/cooldown policy. They do NOT replace the atomic
 * Firestore transaction in `claimWaterRequest()` — that transaction
 * remains the sole authority over whether a claim succeeds.
 */

const DRIVER_OFFERS_COLLECTION = "driverOffers";

function toDriverOffer(id: string, data: DocumentData): DriverOffer {
  return {
    id,
    requestId: data.requestId,
    driverId: data.driverId,
    offeredAt: data.offeredAt?.toDate?.().toISOString() ?? new Date(0).toISOString(),
    response: (data.response ?? null) as DriverOfferResponse,
    respondedAt: data.respondedAt?.toDate?.().toISOString() ?? null,
  };
}

/**
 * Formats a date as its calendar day (YYYY-MM-DD) in the given IANA
 * timezone. Using the formatted calendar date for comparison (rather than
 * computing a UTC offset boundary by hand) is correct regardless of a
 * timezone's offset or any daylight-saving rules, and keeps this simple.
 */
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// ---------------------------------------------------------------------------
// Create / respond
// ---------------------------------------------------------------------------

/**
 * Creates a new pending offer of `requestId` to `driverId`.
 */
export async function createDriverOffer(
  driverId: string,
  requestId: string,
): Promise<DriverOffer> {
  const db = getAdminDb();
  const ref = db.collection(DRIVER_OFFERS_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    requestId,
    driverId,
    offeredAt: now,
    response: null,
    respondedAt: null,
  });

  const created = await ref.get();
  return toDriverOffer(ref.id, created.data()!);
}

/**
 * Records a driver's response (or system expiration) to an offer.
 */
export async function recordOfferResponse(
  offerId: string,
  response: Exclude<DriverOfferResponse, null>,
): Promise<void> {
  const db = getAdminDb();
  await db.collection(DRIVER_OFFERS_COLLECTION).doc(offerId).update({
    response,
    respondedAt: FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns the driver's currently pending (unanswered) offer, if any.
 * Used so reloading the driver portal shows the *same* offer rather than
 * generating a new one on every page view.
 */
export async function getPendingOfferForDriver(
  driverId: string,
): Promise<DriverOffer | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(DRIVER_OFFERS_COLLECTION)
    .where("driverId", "==", driverId)
    .where("response", "==", null)
    .orderBy("offeredAt", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return toDriverOffer(snapshot.docs[0].id, snapshot.docs[0].data());
}

/**
 * Returns the set of request IDs this driver has already declined.
 * Used to avoid immediately re-offering the same request back to the
 * same driver. Bounded to a reasonable lookback so the query stays cheap
 * at island scale while still preventing obvious re-offer loops.
 */
export async function getDeclinedRequestIdsForDriver(
  driverId: string,
  limit = 300,
): Promise<Set<string>> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(DRIVER_OFFERS_COLLECTION)
    .where("driverId", "==", driverId)
    .where("response", "==", "declined")
    .orderBy("respondedAt", "desc")
    .limit(limit)
    .get();

  return new Set(snapshot.docs.map((doc) => doc.data().requestId as string));
}

/**
 * Counts how many offers this driver has declined during the current
 * local operational day (see `appConfig.operationalTimezone`).
 *
 * Implementation note: we bound the Firestore query with a generous
 * 26-hour lookback (covers any timezone offset safely) and then filter
 * precisely by comparing formatted local calendar dates. This avoids
 * having to compute an exact UTC instant for "local midnight," which is
 * unnecessary complexity for a fixed-offset timezone and remains correct
 * even if the operational timezone ever changes to one with DST.
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

  const todayKey = localDateKey(new Date(), appConfig.operationalTimezone);

  return snapshot.docs.filter((doc) => {
    const respondedAt = doc.data().respondedAt?.toDate?.();
    return (
      respondedAt instanceof Date &&
      localDateKey(respondedAt, appConfig.operationalTimezone) === todayKey
    );
  }).length;
}

/**
 * Returns aggregate offer counts across all drivers for the statistics
 * dashboard. Reads are unbounded by driver but bounded by period at the
 * call site (see src/lib/domain/statistics.ts).
 */
export interface OfferAggregate {
  offered: number;
  accepted: number;
  declined: number;
  expired: number;
}

export async function getOfferAggregate(periodStart: Date | null): Promise<OfferAggregate> {
  const db = getAdminDb();
  let query = db.collection(DRIVER_OFFERS_COLLECTION) as FirebaseFirestore.Query;
  if (periodStart) {
    query = query.where("offeredAt", ">=", periodStart);
  }
  const snapshot = await query.get();

  const aggregate: OfferAggregate = { offered: 0, accepted: 0, declined: 0, expired: 0 };
  for (const doc of snapshot.docs) {
    aggregate.offered++;
    const response = doc.data().response as DriverOfferResponse;
    if (response === "accepted") aggregate.accepted++;
    else if (response === "declined") aggregate.declined++;
    else if (response === "expired") aggregate.expired++;
  }
  return aggregate;
}
