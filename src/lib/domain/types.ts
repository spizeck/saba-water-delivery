/**
 * Core domain types for the water delivery system.
 *
 * These types mirror the Firestore data model described in TECHNICAL.md.
 * They are intentionally kept close to the persisted shape so that the
 * same types can be shared between server-side domain logic, client UI,
 * and (eventually) non-web interfaces such as WhatsApp.
 */

export type UserRole = "resident" | "driver" | "dispatcher" | "admin";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;

  village: string | null;
  deliveryDirections: string | null;

  createdAt: string;
  updatedAt: string;
}

export type DriverAuthorizationStatus = "active" | "suspended";
export type DriverAvailabilityStatus = "online" | "offline";

export interface DriverProfile {
  userId: string;

  authorizationStatus: DriverAuthorizationStatus;
  availabilityStatus: DriverAvailabilityStatus;

  suspensionReason: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Resident-facing statuses stay simple. Internal implementation details
 * (e.g. additional bookkeeping states) may be added later without
 * changing what is shown to residents.
 */
export type WaterRequestStatus =
  | "requested"
  | "preferred_driver_hold"
  | "available"
  | "claimed"
  | "delivered"
  | "confirmed"
  | "delivered_unconfirmed"
  | "disputed"
  | "cancelled";

/**
 * Every request is exactly 1,000 gallons in V1. This type exists so the
 * intent is explicit in code even though the value never varies.
 */
export type StandardLoadGallons = 1000;

export interface WaterRequest {
  id: string;
  customerId: string;

  gallons: StandardLoadGallons;

  village: string;
  deliveryDirections: string;

  preferredDriverId: string | null;
  preferredDriverExpiresAt: string | null;

  assignedDriverId: string | null;

  status: WaterRequestStatus;

  requestedAt: string;
  availableAt: string | null;
  claimedAt: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export type WaterRequestEventType =
  | "request_created"
  | "preferred_driver_selected"
  | "preferred_driver_expired"
  | "request_opened"
  | "driver_claimed"
  | "driver_reassigned"
  | "marked_delivered"
  | "customer_confirmed"
  | "customer_disputed"
  | "request_cancelled";

export interface WaterRequestEvent {
  id: string;
  type: WaterRequestEventType;
  actorId: string | null;
  actorRole: UserRole | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}
