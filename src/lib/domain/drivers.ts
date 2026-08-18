import "server-only";

import type { DriverProfile } from "./types";

/**
 * Domain/service layer for driver availability and authorization.
 *
 * See src/lib/domain/waterRequests.ts for the rationale: all mutation of
 * driver state must flow through here so web and future WhatsApp
 * interfaces share one implementation.
 *
 * NOT YET IMPLEMENTED: signature-level stubs pending Firestore Admin
 * configuration.
 */

export interface SetDriverAvailabilityInput {
  driverId: string;
  availabilityStatus: DriverProfile["availabilityStatus"];
}

export async function setDriverAvailability(
  _input: SetDriverAvailabilityInput,
): Promise<DriverProfile> {
  throw new Error("setDriverAvailability is not implemented yet.");
}

export interface SuspendDriverInput {
  driverId: string;
  suspendedBy: string;
  reason: string;
}

export async function suspendDriver(
  _input: SuspendDriverInput,
): Promise<DriverProfile> {
  throw new Error("suspendDriver is not implemented yet.");
}

export interface ReactivateDriverInput {
  driverId: string;
  reactivatedBy: string;
}

export async function reactivateDriver(
  _input: ReactivateDriverInput,
): Promise<DriverProfile> {
  throw new Error("reactivateDriver is not implemented yet.");
}
