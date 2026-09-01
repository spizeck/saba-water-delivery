import type {
  DispatchPriority,
  DriverAvailabilityStatus,
  DriverEligibilityStatus,
  DriverRegistryEntry,
  RequestedLoads,
  WaterRequest,
  WaterRequestSource,
  WaterRequestStatus,
} from "./types";

export interface ViewerRequestRow {
  id: string;
  status: WaterRequestStatus;
  dispatchPriority: DispatchPriority;
  loads: RequestedLoads;
  village: string;
  source: WaterRequestSource;
  requestedAt: string;
  hasAssignedDriver: boolean;
}

export interface ViewerDriverRow {
  id: string;
  displayName: string;
  eligibilityStatus: DriverEligibilityStatus;
  availabilityStatus: DriverAvailabilityStatus;
  accountLinked: boolean;
}

export function toViewerRequestRow(request: WaterRequest): ViewerRequestRow {
  return {
    id: request.id,
    status: request.status,
    dispatchPriority: request.dispatchPriority,
    loads: request.loads,
    village: request.village,
    source: request.source,
    requestedAt: request.requestedAt,
    hasAssignedDriver: Boolean(request.assignedDriverId),
  };
}

export function toViewerDriverRow(driver: DriverRegistryEntry): ViewerDriverRow {
  return {
    id: driver.id,
    displayName: driver.displayName,
    eligibilityStatus: driver.eligibilityStatus,
    availabilityStatus: driver.availabilityStatus,
    accountLinked: Boolean(driver.linkedUserId),
  };
}
