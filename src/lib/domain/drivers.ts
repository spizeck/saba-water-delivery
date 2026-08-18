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

export interface RestrictDriverAccessInput {
  driverId: string;
  restrictedBy: string;
  reason: string;
}

export async function restrictDriverAccess(
  _input: RestrictDriverAccessInput,
): Promise<DriverProfile> {
  throw new Error("restrictDriverAccess is not implemented yet.");
}

export interface RestoreDriverAccessInput {
  driverId: string;
  restoredBy: string;
}

export async function restoreDriverAccess(
  _input: RestoreDriverAccessInput,
): Promise<DriverProfile> {
  throw new Error("restoreDriverAccess is not implemented yet.");
}
