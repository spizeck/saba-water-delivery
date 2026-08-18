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
  roles: UserRole[];

  village: string | null;
  deliveryDirections: string | null;

  createdAt: string;
  updatedAt: string;
}

export type DriverEligibilityStatus = "eligible" | "ineligible";
export type DriverAvailabilityStatus = "online" | "offline";

export interface DriverProfile {
  userId: string;

  eligibilityStatus: DriverEligibilityStatus;
  availabilityStatus: DriverAvailabilityStatus;

  ineligibilityReason: string | null;
  restrictedAt: string | null;
  restrictedBy: string | null;

  /**
   * When set to a future timestamp, the driver has exceeded the daily
   * decline limit and is temporarily paused from receiving new dispatch
   * offers. This is a dispatch/availability control, separate from
   * `eligibilityStatus` (government authorization) and `availabilityStatus`
   * (the driver's own online/offline preference). See TECHNICAL.md
   * "Dispatch Offers".
   */
  cooldownUntil: string | null;

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

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * Property photos help drivers locate the delivery point.
 * Metadata is stored in Firestore at users/{uid}/propertyPhotos/{photoId}.
 * Actual image files are stored in Firebase Storage at the referenced
 * storagePath. See TECHNICAL.md "Firebase Storage".
 */
export type PropertyPhotoType = "house" | "cistern" | "access" | "other";

export interface PropertyPhoto {
  id: string;
  type: PropertyPhotoType;
  /** Firebase Storage path — not a public URL. */
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request photos document a delivery (proof of delivery, issues, etc.).
 * Metadata is stored in Firestore at waterRequests/{requestId}/photos/{photoId}.
 * Only the assigned driver may upload photos for a request.
 */
export type WaterRequestPhotoType =
  | "proof_of_delivery"
  | "delivery_issue"
  | "access_issue"
  | "other";

export interface WaterRequestPhoto {
  id: string;
  type: WaterRequestPhotoType;
  /** Firebase Storage path — not a public URL. */
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Water request events
// ---------------------------------------------------------------------------

export type WaterRequestEventType =
  | "request_created"
  | "preferred_driver_selected"
  | "preferred_driver_expired"
  | "preferred_driver_declined"
  | "request_opened"
  | "driver_claimed"
  | "marked_delivered"
  | "customer_confirmed"
  | "customer_disputed"
  | "delivery_confirmation_expired"
  | "dispute_resolved_completed"
  | "dispute_resolved_reopened"
  | "request_cancelled"
  | "dispatcher_assigned"
  | "dispatcher_reassigned";

export interface WaterRequestEvent {
  id: string;
  type: WaterRequestEventType;
  actorId: string | null;
  actorRole: UserRole | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Driver events
// ---------------------------------------------------------------------------

export type DriverEventType =
  | "driver_online"
  | "driver_offline"
  | "driver_access_restricted"
  | "driver_access_restored"
  | "driver_cooldown_started";

export interface DriverEvent {
  id: string;
  type: DriverEventType;
  actorId: string | null;
  actorRole: UserRole | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Driver dispatch offers (one-request-at-a-time offer workflow)
// ---------------------------------------------------------------------------

/**
 * `null` means the offer is still pending — the driver has not yet
 * responded. "expired" means the offer was superseded (e.g. another driver
 * claimed the request first, or the request was cancelled/reassigned)
 * before this driver responded.
 */
export type DriverOfferResponse = "accepted" | "declined" | "expired" | null;

export interface DriverOffer {
  id: string;
  requestId: string;
  driverId: string;
  offeredAt: string;
  response: DriverOfferResponse;
  respondedAt: string | null;
}

// ---------------------------------------------------------------------------
// Dispatch settings (admin-configurable)
// ---------------------------------------------------------------------------

export interface DispatchSettings {
  maxDeclinesPerDay: number;
  declineCooldownHours: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
