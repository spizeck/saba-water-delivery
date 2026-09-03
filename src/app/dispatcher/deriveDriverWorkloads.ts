import { isPhysicallyActiveDriverWork } from "@/lib/domain/activeRequestValidation";
import type { DriverRegistryEntry, WaterRequest } from "@/lib/domain/types";

/** Compact summary of one claimed request. */
export interface DriverRequestSummary {
  requestId: string;
  customerName: string;
  village: string;
  loads: number;
  loadsCollected: number;
  isBatchAssigned: boolean;
  isEscalated: boolean;
  dispatchBatchId: string | null;
}

/** Current remaining work for one active Delivery Run. */
export interface DriverRunSummary {
  batchId: string;
  remainingStops: number;
  remainingLoads: number;
  totalStops: number;
  totalLoads: number;
  link: string;
}

export type DriverOperationalState =
  | "offline"
  | "available"
  | "individual"
  | "delivery_run";

/** Per-driver operational workload, keyed by registry ID on the dashboard. */
export interface DriverWorkload {
  openRequests: number;
  openLoads: number;
  requests: DriverRequestSummary[];
  individualRequests: DriverRequestSummary[];
  runs: DriverRunSummary[];
  state: DriverOperationalState;
}

function toRequestSummary(
  req: WaterRequest,
  customerNames: Record<string, string>,
): DriverRequestSummary {
  return {
    requestId: req.id,
    customerName: customerNames[req.id] ?? "Unknown",
    village: req.village,
    loads: req.loads,
    loadsCollected: req.loadCollections?.length ?? 0,
    isBatchAssigned: Boolean(req.dispatchBatchId),
    isEscalated: req.dispatchOverrideRank != null,
    dispatchBatchId: req.dispatchBatchId,
  };
}

/**
 * Derive an operational workload map for each active driver. Reuses the
 * canonical active-work rule: only requests in `claimed` status are active
 * physical driver work. Delivered, confirmed, disputed, and cancelled
 * requests are ignored so awaiting resident confirmation does not make a
 * driver appear busy.
 *
 * Delivery Run remaining work is derived from the current `dispatchBatchId`
 * membership already loaded in `allRequests`, with no extra Firestore calls.
 */
export function deriveDriverWorkloads(
  drivers: DriverRegistryEntry[],
  requests: WaterRequest[],
  customerNames: Record<string, string>,
): Record<string, DriverWorkload> {
  const uidToRegistryId = new Map<string, string>();
  for (const d of drivers) {
    if (d.linkedUserId) uidToRegistryId.set(d.linkedUserId, d.id);
  }

  // Active claimed requests grouped by driver registry ID.
  const activeByDriver: Record<string, WaterRequest[]> = {};
  for (const req of requests) {
    if (!isPhysicallyActiveDriverWork(req.status) || !req.assignedDriverId) continue;
    const registryId = uidToRegistryId.get(req.assignedDriverId);
    if (!registryId) continue;
    if (!activeByDriver[registryId]) activeByDriver[registryId] = [];
    activeByDriver[registryId].push(req);
  }

  // All current batch members, including delivered/confirmed/disputed, so
  // we can report total-vs-remaining for each active run.
  const allByBatch: Record<string, WaterRequest[]> = {};
  for (const req of requests) {
    if (!req.dispatchBatchId) continue;
    if (!allByBatch[req.dispatchBatchId]) allByBatch[req.dispatchBatchId] = [];
    allByBatch[req.dispatchBatchId].push(req);
  }

  const workloads: Record<string, DriverWorkload> = {};

  for (const d of drivers) {
    const activeRequests = activeByDriver[d.id] ?? [];
    const requestSummaries = activeRequests.map((r) => toRequestSummary(r, customerNames));
    const individualRequests = requestSummaries.filter((r) => !r.isBatchAssigned);

    const runIds = [
      ...new Set(activeRequests.filter((r) => r.dispatchBatchId).map((r) => r.dispatchBatchId!)),
    ];
    const runs: DriverRunSummary[] = [];

    for (const batchId of runIds) {
      const allMembers = allByBatch[batchId] ?? [];
      const remaining = allMembers.filter((m) => isPhysicallyActiveDriverWork(m.status));
      if (remaining.length === 0) continue;

      const totalStops = allMembers.length;
      const totalLoads = allMembers.reduce((sum, m) => sum + m.loads, 0);
      const remainingStops = remaining.length;
      const remainingLoads = remaining.reduce((sum, m) => sum + m.loads, 0);

      runs.push({
        batchId,
        remainingStops,
        remainingLoads,
        totalStops,
        totalLoads,
        link: `/dispatcher/batches/${batchId}`,
      });
    }

    let state: DriverOperationalState;
    if (d.availabilityStatus !== "online") {
      state = "offline";
    } else if (runs.length > 0) {
      state = "delivery_run";
    } else if (individualRequests.length > 0) {
      state = "individual";
    } else {
      state = "available";
    }

    workloads[d.id] = {
      openRequests: requestSummaries.length,
      openLoads: requestSummaries.reduce((sum, r) => sum + r.loads, 0),
      requests: requestSummaries,
      individualRequests,
      runs,
      state,
    };
  }

  return workloads;
}
