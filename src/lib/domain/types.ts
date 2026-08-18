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

/**
 * Who originated the request. Resident-created requests come from the
 * authenticated resident portal; dispatcher-created requests are entered
 * by government staff on behalf of a customer who called or visited the
 * office. Both sources enter the exact same delivery workflow — there is
 * no separate manual queue. See PRODUCT.md "Dispatcher-Created Requests".
 */
export type WaterRequestSource = "resident" | "dispatcher";

/**
 * A snapshot of the customer's identity at request creation time,
 * preserved on the request itself so it remains stable and auditable
 * regardless of later profile edits, and so unregistered/manual
 * customers (who have no `users/{uid}` document) can still be served.
 *
 * `isRegistered` mirrors `customerId !== null` at creation time — it is
 * denormalized onto the snapshot for convenience in UI code and
 * statistics.
 */
export interface WaterRequestCustomerSnapshot {
  displayName: string;
  phone: string | null;
  email: string | null;
  isRegistered: boolean;
}

export interface WaterRequest {
  id: string;
  /**
   * The requesting resident's Firebase uid, or `null` for a request
   * created by dispatcher/admin staff on behalf of a customer who does
   * not have (and is not required to have) an application account. See
   * PRODUCT.md "Unregistered Customers".
   */
  customerId: string | null;

  /** Snapshot of the customer's name/contact info at creation time. Only
   * `null` for historical documents created before this field existed —
   * new code should prefer this over a live profile lookup. */
  customer: WaterRequestCustomerSnapshot | null;

  /** Where the request originated. Defaults to "resident" for historical
   * documents that predate this field (all pre-existing requests were
   * resident-created). */
  source: WaterRequestSource;

  /** uid of the dispatcher/admin who created this request. Always null
   * for `source === "resident"`. */
  createdBy: string | null;

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
  | "request_created_by_dispatcher"
  | "preferred_driver_selected"
  | "preferred_driver_expired"
  | "preferred_driver_declined"
  | "request_opened"
  | "driver_claimed"
  | "marked_delivered"
  | "customer_confirmed"
  | "delivery_confirmed_by_dispatcher"
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
