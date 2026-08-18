import "server-only";

import type { WaterRequest } from "./types";

/**
 * Domain/service layer for water request operations.
 *
 * These functions are the single source of business logic for creating,
 * claiming, and progressing a water request through its lifecycle. Every
 * caller — the resident web UI, the driver web UI, the dispatcher/admin
 * UI, and (later) a WhatsApp integration — must call through these
 * functions rather than writing to Firestore directly.
 *
 * NOT YET IMPLEMENTED: these are signature-level stubs establishing the
 * shape of the domain layer. Implementation requires a configured
 * Firebase Admin project (see src/lib/firebase/admin.ts) and the
 * Firestore schema described in TECHNICAL.md, including the atomic
 * transaction semantics required for claiming.
 */

export interface CreateWaterRequestInput {
  customerId: string;
  village: string;
  deliveryDirections: string;
  preferredDriverId?: string | null;
}

export async function createWaterRequest(
  _input: CreateWaterRequestInput,
): Promise<WaterRequest> {
  throw new Error("createWaterRequest is not implemented yet.");
}

export interface ClaimWaterRequestInput {
  requestId: string;
  driverId: string;
}

export async function claimWaterRequest(
  _input: ClaimWaterRequestInput,
): Promise<WaterRequest> {
  // Must be implemented as a Firestore transaction. See TECHNICAL.md
  // "Request Claiming" — never read-check-write outside a transaction.
  throw new Error("claimWaterRequest is not implemented yet.");
}

export interface MarkWaterDeliveredInput {
  requestId: string;
  driverId: string;
}

export async function markWaterDelivered(
  _input: MarkWaterDeliveredInput,
): Promise<WaterRequest> {
  throw new Error("markWaterDelivered is not implemented yet.");
}

export interface ConfirmWaterDeliveryInput {
  requestId: string;
  customerId: string;
}

export async function confirmWaterDelivery(
  _input: ConfirmWaterDeliveryInput,
): Promise<WaterRequest> {
  throw new Error("confirmWaterDelivery is not implemented yet.");
}

export interface DisputeWaterDeliveryInput {
  requestId: string;
  customerId: string;
  reason?: string;
}

export async function disputeWaterDelivery(
  _input: DisputeWaterDeliveryInput,
): Promise<WaterRequest> {
  throw new Error("disputeWaterDelivery is not implemented yet.");
}

export interface CancelWaterRequestInput {
  requestId: string;
  actorId: string;
  reason?: string;
}

export async function cancelWaterRequest(
  _input: CancelWaterRequestInput,
): Promise<WaterRequest> {
  throw new Error("cancelWaterRequest is not implemented yet.");
}

export interface ExpirePreferredDriverHoldInput {
  requestId: string;
}

export async function expirePreferredDriverHold(
  _input: ExpirePreferredDriverHoldInput,
): Promise<WaterRequest> {
  throw new Error("expirePreferredDriverHold is not implemented yet.");
}
