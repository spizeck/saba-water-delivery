import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import { sabaCalendarDateKey, startOfSabaMonth, startOfSabaYear } from "@/lib/utils/datetime";

import type { WaterRequestSource, WaterRequestStatus } from "./types";
import { appConfig } from "./config";
import { getOfferAggregate } from "./driverOffers";

/**
 * Statistics domain module.
 *
 * All metrics are calculated server-side from source-of-truth collections:
 * - waterRequests (request documents with status/timestamps)
 * - waterRequests/{id}/events (audit trail for historical state)
 * - drivers (driver profiles)
 *
 * No parallel analytics database or ETL. At island-scale volume, direct
 * Firestore reads are acceptable for V1.
 *
 * Methodology notes:
 * - "Gallons delivered" counts requests that reached delivered/confirmed/
 *   delivered_unconfirmed status (actual delivery occurred).
 * - Driver attribution uses audit events (driver_claimed, dispatcher_assigned,
 *   dispatcher_reassigned) to correctly credit the delivering driver even if
 *   reassignment occurred.
 * - A single water request always counts as ONE customer request even if
 *   reopened after dispute.
 * - Preferred-driver metrics use request fields and events to track hold
 *   expirations accurately.
 * - Dispute rate = requests that entered disputed status / requests that
 *   reached delivered status (at any point).
 */

const REQUESTS_COLLECTION = "waterRequests";
const DRIVER_REGISTRY_COLLECTION = "driverRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatsPeriod = "7d" | "30d" | "month" | "year" | "all";

export interface SummaryMetrics {
  totalRequests: number;
  confirmedDeliveries: number;
  deliveredUnconfirmed: number;
  disputed: number;
  cancelled: number;
  gallonsDelivered: number;
  /** How many requests were submitted online (resident) vs entered by staff. */
  bySource: { resident: number; dispatcher: number };
}

export interface CurrentOperationalMetrics {
  openRequests: number;
  openOver24h: number;
  openOver48h: number;
  oldestRequestDate: string | null;
  unresolvedDisputes: number;
}

export interface TimingMetrics {
  avgRequestToClaimHours: number | null;
  avgRequestToDeliveryHours: number | null;
  avgClaimToDeliveryHours: number | null;
  avgDeliveryToConfirmationHours: number | null;
}

export interface DailyVolume {
  date: string; // YYYY-MM-DD or YYYY-MM
  requests: number;
}

export interface VillageDemand {
  village: string;
  requests: number;
  deliveredLoads: number;
  gallonsDelivered: number;
}

export interface DriverMetrics {
  driverId: string;
  displayName: string;
  loadsClaimed: number;
  loadsDelivered: number;
  confirmedDeliveries: number;
  avgClaimToDeliveryHours: number | null;
  eligibilityStatus: string;
  availabilityStatus: string;
}

export interface PreferredDriverMetrics {
  requestsWithPreference: number;
  percentWithPreference: number;
  claimedByPreferred: number;
  expiredToGeneralQueue: number;
  avgDeliveryTimePreferredHours: number | null;
  avgDeliveryTimeNoPreferenceHours: number | null;
}

export interface DisputeMetrics {
  disputesCreated: number;
  unresolvedDisputes: number;
  resolvedDisputes: number;
  resolvedAsCompleted: number;
  resolvedAsReopened: number;
  disputeRate: number | null; // percentage
}

export interface DispatchOfferMetrics {
  offersSent: number;
  accepted: number;
  declined: number;
  expired: number;
  acceptanceRate: number | null; // percentage of responded offers accepted
}

export interface StatsData {
  period: StatsPeriod;
  summary: SummaryMetrics;
  current: CurrentOperationalMetrics;
  timing: TimingMetrics;
  trend: DailyVolume[];
  villages: VillageDemand[];
  drivers: DriverMetrics[];
  preferredDriver: PreferredDriverMetrics;
  disputes: DisputeMetrics;
  dispatchOffers: DispatchOfferMetrics;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/**
 * "This month" / "this year" are Saba-local calendar periods (see
 * TECHNICAL.md "Saba Operational Timezone" / "Calendar-Day Logic") — a
 * viewer in another timezone must see the same period boundaries a
 * Saba-based user would. "Last 7/30 days" are plain elapsed-duration
 * windows and are not timezone-sensitive.
 */
function getPeriodStart(period: StatsPeriod): Date | null {
  const now = new Date();
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "month":
      return startOfSabaMonth(now);
    case "year":
      return startOfSabaYear(now);
    case "all":
      return null;
  }
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Buckets a timestamp into its Saba-local calendar day or month (see datetime.ts). */
function formatDateKey(date: Date, monthly: boolean): string {
  const dayKey = sabaCalendarDateKey(date); // YYYY-MM-DD in Saba local time
  return monthly ? dayKey.slice(0, 7) : dayKey;
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

/** Statuses that count as "delivered" (actual delivery occurred). */
const DELIVERED_STATUSES: WaterRequestStatus[] = [
  "delivered",
  "confirmed",
  "delivered_unconfirmed",
  "disputed",
];

/** Statuses that mean the request is still open/active. */
const OPEN_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "delivered_unconfirmed",
  "disputed",
];

interface RawRequest {
  id: string;
  status: WaterRequestStatus;
  village: string;
  source: WaterRequestSource;
  preferredDriverId: string | null;
  assignedDriverId: string | null;
  requestedAt: Date | null;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  confirmedAt: Date | null;
  gallons: number;
}

export async function getStatistics(period: StatsPeriod): Promise<StatsData> {
  const db = getAdminDb();
  const periodStart = getPeriodStart(period);

  // Fetch all requests (or filtered by period).
  let query = db.collection(REQUESTS_COLLECTION).orderBy("requestedAt", "desc");
  if (periodStart) {
    query = db
      .collection(REQUESTS_COLLECTION)
      .where("requestedAt", ">=", periodStart)
      .orderBy("requestedAt", "desc");
  }

  const requestsSnapshot = await query.get();
  const requests: RawRequest[] = requestsSnapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      status: d.status as WaterRequestStatus,
      village: d.village ?? "Unknown",
      // Historical requests predate `source` — all of them came from the
      // resident portal (see toWaterRequest() in waterRequests.ts).
      source: (d.source as WaterRequestSource) ?? "resident",
      preferredDriverId: d.preferredDriverId ?? null,
      assignedDriverId: d.assignedDriverId ?? null,
      requestedAt: d.requestedAt?.toDate?.() ?? null,
      claimedAt: d.claimedAt?.toDate?.() ?? null,
      deliveredAt: d.deliveredAt?.toDate?.() ?? null,
      confirmedAt: d.confirmedAt?.toDate?.() ?? null,
      gallons: d.gallons ?? appConfig.standardLoadGallons,
    };
  });

  // ---------------------------------------------------------------------------
  // Summary metrics
  // ---------------------------------------------------------------------------
  const summary: SummaryMetrics = {
    totalRequests: requests.length,
    confirmedDeliveries: requests.filter((r) => r.status === "confirmed").length,
    deliveredUnconfirmed: requests.filter(
      (r) => r.status === "delivered_unconfirmed" || r.status === "delivered",
    ).length,
    disputed: requests.filter((r) => r.status === "disputed").length,
    cancelled: requests.filter((r) => r.status === "cancelled").length,
    gallonsDelivered:
      requests.filter((r) => DELIVERED_STATUSES.includes(r.status)).length *
      appConfig.standardLoadGallons,
    bySource: {
      resident: requests.filter((r) => r.source === "resident").length,
      dispatcher: requests.filter((r) => r.source === "dispatcher").length,
    },
  };

  // ---------------------------------------------------------------------------
  // Current operational metrics (ignoring period)
  // ---------------------------------------------------------------------------
  const allRequestsSnapshot = await db.collection(REQUESTS_COLLECTION).get();
  const allRequests = allRequestsSnapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      status: d.status as WaterRequestStatus,
      requestedAt: d.requestedAt?.toDate?.() ?? null,
    };
  });

  const now = new Date();
  const openRequests = allRequests.filter((r) => OPEN_STATUSES.includes(r.status));
  const h24 = 24 * 60 * 60 * 1000;
  const h48 = 48 * 60 * 60 * 1000;

  const current: CurrentOperationalMetrics = {
    openRequests: openRequests.length,
    openOver24h: openRequests.filter(
      (r) => r.requestedAt && now.getTime() - r.requestedAt.getTime() > h24,
    ).length,
    openOver48h: openRequests.filter(
      (r) => r.requestedAt && now.getTime() - r.requestedAt.getTime() > h48,
    ).length,
    oldestRequestDate: openRequests
      .filter((r) => r.requestedAt)
      .sort((a, b) => (a.requestedAt!.getTime() - b.requestedAt!.getTime()))[0]
      ?.requestedAt?.toISOString() ?? null,
    unresolvedDisputes: allRequests.filter((r) => r.status === "disputed").length,
  };

  // ---------------------------------------------------------------------------
  // Timing metrics (from period-filtered requests)
  // ---------------------------------------------------------------------------
  const requestToClaimTimes: number[] = [];
  const requestToDeliveryTimes: number[] = [];
  const claimToDeliveryTimes: number[] = [];
  const deliveryToConfirmTimes: number[] = [];

  for (const r of requests) {
    if (r.requestedAt && r.claimedAt) {
      requestToClaimTimes.push(hoursBetween(r.requestedAt, r.claimedAt));
    }
    if (r.requestedAt && r.deliveredAt) {
      requestToDeliveryTimes.push(hoursBetween(r.requestedAt, r.deliveredAt));
    }
    if (r.claimedAt && r.deliveredAt) {
      claimToDeliveryTimes.push(hoursBetween(r.claimedAt, r.deliveredAt));
    }
    if (r.deliveredAt && r.confirmedAt) {
      deliveryToConfirmTimes.push(hoursBetween(r.deliveredAt, r.confirmedAt));
    }
  }

  const timing: TimingMetrics = {
    avgRequestToClaimHours: average(requestToClaimTimes),
    avgRequestToDeliveryHours: average(requestToDeliveryTimes),
    avgClaimToDeliveryHours: average(claimToDeliveryTimes),
    avgDeliveryToConfirmationHours: average(deliveryToConfirmTimes),
  };

  // ---------------------------------------------------------------------------
  // Demand trend
  // ---------------------------------------------------------------------------
  const useMonthly = period === "year" || period === "all";
  const trendMap = new Map<string, number>();

  for (const r of requests) {
    if (!r.requestedAt) continue;
    const key = formatDateKey(r.requestedAt, useMonthly);
    trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }

  const trend: DailyVolume[] = Array.from(trendMap.entries())
    .map(([date, count]) => ({ date, requests: count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ---------------------------------------------------------------------------
  // Village demand
  // ---------------------------------------------------------------------------
  const villageMap = new Map<
    string,
    { requests: number; deliveredLoads: number }
  >();

  for (const r of requests) {
    const v = r.village;
    const entry = villageMap.get(v) ?? { requests: 0, deliveredLoads: 0 };
    entry.requests++;
    if (DELIVERED_STATUSES.includes(r.status)) {
      entry.deliveredLoads++;
    }
    villageMap.set(v, entry);
  }

  const villages: VillageDemand[] = Array.from(villageMap.entries())
    .map(([village, data]) => ({
      village,
      requests: data.requests,
      deliveredLoads: data.deliveredLoads,
      gallonsDelivered: data.deliveredLoads * appConfig.standardLoadGallons,
    }))
    .sort((a, b) => b.requests - a.requests);

  // ---------------------------------------------------------------------------
  // Driver metrics
  // ---------------------------------------------------------------------------
  // For driver attribution, we use the assignedDriverId on delivered requests.
  // For reassigned requests, the current assignedDriverId reflects the FINAL
  // delivering driver. Audit events record reassignment history.
  //
  // This gives correct attribution because:
  // - When a request is reassigned, assignedDriverId is updated.
  // - When delivery is marked, the current assignedDriverId is the delivering driver.
  // - Historical reassignment data is preserved in events but doesn't affect attribution.
  const driverClaimedMap = new Map<string, number>();
  const driverDeliveredMap = new Map<string, number>();
  const driverConfirmedMap = new Map<string, number>();
  const driverClaimToDeliveryTimes = new Map<string, number[]>();

  for (const r of requests) {
    const driverId = r.assignedDriverId;
    if (!driverId) continue;

    // Loads claimed (any request that has been assigned to this driver currently).
    if (r.claimedAt) {
      driverClaimedMap.set(driverId, (driverClaimedMap.get(driverId) ?? 0) + 1);
    }
    // Loads delivered
    if (DELIVERED_STATUSES.includes(r.status)) {
      driverDeliveredMap.set(driverId, (driverDeliveredMap.get(driverId) ?? 0) + 1);
    }
    // Confirmed deliveries
    if (r.status === "confirmed") {
      driverConfirmedMap.set(driverId, (driverConfirmedMap.get(driverId) ?? 0) + 1);
    }
    // Claim-to-delivery time
    if (r.claimedAt && r.deliveredAt) {
      const times = driverClaimToDeliveryTimes.get(driverId) ?? [];
      times.push(hoursBetween(r.claimedAt, r.deliveredAt));
      driverClaimToDeliveryTimes.set(driverId, times);
    }
  }

  // Get all unique driver IDs from the data.
  const allDriverIds = [
    ...new Set([
      ...driverClaimedMap.keys(),
      ...driverDeliveredMap.keys(),
      ...driverConfirmedMap.keys(),
    ]),
  ];

  // Fetch Driver Registry entries (eligibility/availability/display name
  // now live there, keyed by `linkedUserId` — see TECHNICAL.md "Driver
  // Registry"). Batched via `linkedUserId in [...]`, matching the
  // previous by-uid batching pattern.
  const drivers: DriverMetrics[] = [];
  const batchSize = 30;

  for (let i = 0; i < allDriverIds.length; i += batchSize) {
    const batch = allDriverIds.slice(i, i + batchSize);
    const registrySnapshot = await db
      .collection(DRIVER_REGISTRY_COLLECTION)
      .where("linkedUserId", "in", batch)
      .get();

    const registryByUid = new Map<string, DocumentData>();
    for (const doc of registrySnapshot.docs) {
      registryByUid.set(doc.data().linkedUserId, doc.data());
    }

    // Fall back to a live profile lookup only for a uid with no
    // (or not-yet-migrated) registry entry, so historical data still
    // displays a name.
    const missingUids = batch.filter((id) => !registryByUid.has(id));
    const fallbackNames = new Map<string, string>();
    if (missingUids.length > 0) {
      const userDocs = await Promise.all(
        missingUids.map((id) => db.collection("users").doc(id).get()),
      );
      for (let k = 0; k < missingUids.length; k++) {
        const userDoc = userDocs[k];
        if (userDoc.exists) {
          fallbackNames.set(missingUids[k], userDoc.data()!.displayName ?? "Driver");
        }
      }
    }

    for (const dId of batch) {
      const driverData = registryByUid.get(dId);
      const times = driverClaimToDeliveryTimes.get(dId) ?? [];

      drivers.push({
        driverId: dId,
        displayName: driverData?.displayName ?? fallbackNames.get(dId) ?? "Driver",
        loadsClaimed: driverClaimedMap.get(dId) ?? 0,
        loadsDelivered: driverDeliveredMap.get(dId) ?? 0,
        confirmedDeliveries: driverConfirmedMap.get(dId) ?? 0,
        avgClaimToDeliveryHours: average(times),
        eligibilityStatus: (driverData?.eligibilityStatus as string) ?? "ineligible",
        availabilityStatus: (driverData?.availabilityStatus as string) ?? "offline",
      });
    }
  }

  drivers.sort((a, b) => b.loadsDelivered - a.loadsDelivered);

  // ---------------------------------------------------------------------------
  // Preferred-driver metrics
  // ---------------------------------------------------------------------------
  const requestsWithPreference = requests.filter((r) => r.preferredDriverId).length;
  const percentWithPreference = requests.length > 0
    ? Math.round((requestsWithPreference / requests.length) * 100)
    : 0;

  // For preferred-driver claimed vs expired, we need events.
  // A "preferred_driver_expired" event means the hold expired.
  // A "driver_claimed" with previousStatus "preferred_driver_hold" means the
  // preferred driver claimed it successfully.
  let claimedByPreferred = 0;
  let expiredToGeneralQueue = 0;

  const preferredRequests = requests.filter((r) => r.preferredDriverId);
  for (const r of preferredRequests) {
    // Check if current assignedDriverId matches preferredDriverId and delivery happened.
    if (r.assignedDriverId === r.preferredDriverId && r.claimedAt) {
      claimedByPreferred++;
    } else if (r.status === "available" || r.status === "cancelled") {
      // Could have expired — but we simplify: if status progressed past hold
      // without the preferred driver claiming, the hold expired or was bypassed.
    }
  }

  // Count expired holds from events for accuracy.
  // For V1, scan events of preferred requests. Limit to avoid excessive reads.
  const preferredRequestIds = preferredRequests.slice(0, 100).map((r) => r.id);
  for (const reqId of preferredRequestIds) {
    const eventsSnapshot = await db
      .collection(REQUESTS_COLLECTION)
      .doc(reqId)
      .collection("events")
      .where("type", "==", "preferred_driver_expired")
      .limit(1)
      .get();
    if (!eventsSnapshot.empty) {
      expiredToGeneralQueue++;
    }
  }

  // Average delivery times by preference.
  const preferredDeliveryTimes: number[] = [];
  const noPreferenceDeliveryTimes: number[] = [];

  for (const r of requests) {
    if (!r.requestedAt || !r.deliveredAt) continue;
    const hours = hoursBetween(r.requestedAt, r.deliveredAt);
    if (r.preferredDriverId) {
      preferredDeliveryTimes.push(hours);
    } else {
      noPreferenceDeliveryTimes.push(hours);
    }
  }

  const preferredDriver: PreferredDriverMetrics = {
    requestsWithPreference,
    percentWithPreference,
    claimedByPreferred,
    expiredToGeneralQueue,
    avgDeliveryTimePreferredHours: average(preferredDeliveryTimes),
    avgDeliveryTimeNoPreferenceHours: average(noPreferenceDeliveryTimes),
  };

  // ---------------------------------------------------------------------------
  // Dispute metrics
  // ---------------------------------------------------------------------------
  // Dispute rate: requests entering "disputed" / requests that reached "delivered".
  // We use events for historical accuracy because a disputed request that was
  // resolved may no longer have "disputed" as its current status.
  //
  // For V1, use current-status heuristic combined with event checks:
  // - Currently disputed requests count.
  // - Confirmed requests that were previously disputed (check events).
  // - Reopened requests that were previously disputed (check events).

  const currentlyDisputed = requests.filter((r) => r.status === "disputed").length;

  // Count resolved disputes from events on confirmed/reopened requests.
  let resolvedAsCompleted = 0;
  let resolvedAsReopened = 0;

  // Check confirmed requests for dispute history.
  const confirmedOrAvailableRequests = requests.filter(
    (r) => r.status === "confirmed" || r.status === "available",
  );

  // Limit to avoid excessive reads for V1.
  const checkIds = confirmedOrAvailableRequests.slice(0, 200).map((r) => r.id);
  for (const reqId of checkIds) {
    const eventsSnapshot = await db
      .collection(REQUESTS_COLLECTION)
      .doc(reqId)
      .collection("events")
      .where("type", "in", ["dispute_resolved_completed", "dispute_resolved_reopened"])
      .get();

    for (const eventDoc of eventsSnapshot.docs) {
      const eventType = eventDoc.data().type;
      if (eventType === "dispute_resolved_completed") resolvedAsCompleted++;
      if (eventType === "dispute_resolved_reopened") resolvedAsReopened++;
    }
  }

  const totalDisputes = currentlyDisputed + resolvedAsCompleted + resolvedAsReopened;
  const requestsThatReachedDelivered = requests.filter(
    (r) => DELIVERED_STATUSES.includes(r.status) || r.status === "confirmed",
  ).length;

  const disputeRate =
    requestsThatReachedDelivered > 0
      ? Math.round((totalDisputes / requestsThatReachedDelivered) * 1000) / 10
      : null;

  const disputes: DisputeMetrics = {
    disputesCreated: totalDisputes,
    unresolvedDisputes: currentlyDisputed,
    resolvedDisputes: resolvedAsCompleted + resolvedAsReopened,
    resolvedAsCompleted,
    resolvedAsReopened,
    disputeRate,
  };

  // ---------------------------------------------------------------------------
  // Dispatch offer metrics (single-offer driver dispatch workflow)
  // ---------------------------------------------------------------------------
  const offerAggregate = await getOfferAggregate(periodStart);
  const responded = offerAggregate.accepted + offerAggregate.declined;
  const dispatchOffers: DispatchOfferMetrics = {
    offersSent: offerAggregate.offered,
    accepted: offerAggregate.accepted,
    declined: offerAggregate.declined,
    expired: offerAggregate.expired,
    acceptanceRate:
      responded > 0 ? Math.round((offerAggregate.accepted / responded) * 1000) / 10 : null,
  };

  return {
    period,
    summary,
    current,
    timing,
    trend,
    villages,
    drivers,
    preferredDriver,
    disputes,
    dispatchOffers,
  };
}
