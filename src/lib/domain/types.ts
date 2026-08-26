/**
 * Core domain types for the water delivery system.
 *
 * These types mirror the Firestore data model described in TECHNICAL.md.
 * They are intentionally kept close to the persisted shape so that the
 * same types can be shared between server-side domain logic, client UI,
 * and (eventually) non-web interfaces such as WhatsApp.
 */

/**
 * `viewer` is a read-only oversight role for government personnel who
 * need visibility into operations without operational control. See
 * PRODUCT.md / TECHNICAL.md "Viewer Role".
 */
export type UserRole = "resident" | "driver" | "dispatcher" | "admin" | "viewer";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  roles: UserRole[];

  village: string | null;
  deliveryDirections: string | null;

  /**
   * When the resident last affirmatively reviewed their delivery
   * information (phone/village/deliveryDirections) and confirmed it was
   * still correct — either by explicitly clicking "Everything Is
   * Correct" on the delivery-profile reminder, or by saving a change to
   * one of those fields (which is itself a fresh review). Distinct from
   * `updatedAt`, which changes on ANY profile save (e.g. display name
   * only). Null means never confirmed — see PRODUCT.md / TECHNICAL.md
   * "Delivery Profile Confirmation Reminder". Missing on historical
   * documents that predate this field; treated as null (never
   * confirmed), never backfilled.
   */
  deliveryProfileConfirmedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export type DriverEligibilityStatus = "eligible" | "ineligible";
export type DriverAvailabilityStatus = "online" | "offline";

/**
 * Resident-facing statuses stay simple. Internal implementation details
 * (e.g. additional bookkeeping states) may be added later without
 * changing what is shown to residents.
 *
 * There is deliberately no separate "delivered but unconfirmed" status.
 * A `"delivered"` request that receives no resident response within the
 * confirmation window is automatically transitioned straight to
 * `"confirmed"` — see PRODUCT.md "Delivery Confirmation" and
 * TECHNICAL.md "Delivery Confirmation Timeout". Display code that wants
 * to distinguish "delivered, awaiting confirmation" from "delivered and
 * confirmed" should compute that from `status === "delivered"` plus the
 * confirmation deadline (`src/lib/domain/deliveryConfirmation.ts`),
 * never from a separate persisted status.
 */
export type WaterRequestStatus =
  | "requested"
  | "preferred_driver_hold"
  | "available"
  | "claimed"
  | "delivered"
  | "confirmed"
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
 * office; whatsapp requests come from the resident WhatsApp ordering
 * conversation (see TECHNICAL.md "WhatsApp Resident Ordering") — like
 * `"resident"`, this is a customer self-service channel, NOT a
 * staff-on-behalf-of-customer channel, so it deliberately shares the
 * same audit-event branch as `"resident"` in `createWaterRequest()`
 * (only `"dispatcher"` is treated as staff-initiated). All three enter
 * the exact same delivery workflow — there is no separate manual queue
 * or parallel request system. See PRODUCT.md "Dispatcher-Created
 * Requests".
 */
export type WaterRequestSource = "resident" | "dispatcher" | "whatsapp";

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

// ---------------------------------------------------------------------------
// Water situation / dispatch priority
// ---------------------------------------------------------------------------

/**
 * Structured vulnerable-person / critical-circumstance options. This is
 * intentionally NOT a medical intake form — see PRODUCT.md "Vulnerable
 * Persons / Critical Circumstances".
 *
 * NOTE: "essential_services_commercial_business" and
 * "hotel_or_restaurant" overlap materially (a hotel or restaurant IS an
 * essential/commercial business). Both are kept as distinct canonical
 * options at government's explicit request rather than silently merged
 * or renamed — see PRODUCT.md "Vulnerable Persons / Critical
 * Circumstances" for the flagged policy note.
 */
export type VulnerableCircumstance =
  | "elderly"
  | "infant_or_young_child"
  | "medical_need"
  | "essential_services_commercial_business"
  | "hotel_or_restaurant"
  | "none";

/**
 * The resident's own characterization of urgency. See PRODUCT.md
 * "Resident-Reported Urgency". Deliberately only two options —
 * "Urgent" was removed from the resident-facing form after government
 * testing found it caused subjective debate; residents now choose only
 * Normal or Critical. This is captured separately from the operational
 * `DispatchPriority` (below), which still supports `"urgent"` for
 * dispatcher/admin use — see "Do Not Conflate Reported Urgency With
 * Dispatch Priority" in PRODUCT.md.
 */
export type ReportedUrgency = "normal" | "critical";

/**
 * A snapshot of the resident's reported water situation at the time the
 * request was made. Preserved on the request itself (never re-derived
 * from a later profile lookup) because these facts describe the
 * circumstances at request time — see PRODUCT.md "Historical Snapshot".
 */
export interface WaterSituationSnapshot {
  /** Number of people relying on this water supply. Null if not provided
   * (e.g. an unregistered caller who couldn't say). */
  personsAffected: number | null;
  /** May be empty (treated the same as ["none"]) if nothing was selected. */
  vulnerableCircumstances: VulnerableCircumstance[];
  /** Resident-reported available cistern/storage capacity, as free-form text. */
  availableStorageCapacity: string | null;
  /** The resident's own characterization of urgency. */
  reportedUrgency: ReportedUrgency;
  /**
   * Required explanation when `reportedUrgency === "critical"`. Null
   * whenever `reportedUrgency` is `"normal"` — never retains stale text
   * from a Critical selection the resident backed away from before
   * submitting. See PRODUCT.md "Critical Explanation".
   */
  criticalExplanation: string | null;
}

/**
 * The system's OPERATIONAL dispatch priority for a request. Distinct
 * from the resident's own `WaterSituationSnapshot.reportedUrgency` — see
 * PRODUCT.md "Do Not Blindly Trust Self-Declared Priority". Determines
 * offer ordering (see TECHNICAL.md "Priority-Based Dispatch") but never
 * bypasses fairness-by-age within the same priority level.
 */
export type DispatchPriority = "normal" | "urgent" | "critical";

/** How the current `dispatchPriority` was established. */
export type PrioritySource = "system" | "dispatcher";

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

  /** Snapshot of the resident's reported water situation at creation
   * time. Null only for historical documents that predate this field —
   * see PRODUCT.md "Historical Snapshot". Never null on new requests. */
  waterSituation: WaterSituationSnapshot | null;

  /** Whether the resident (or dispatcher recording on a caller's behalf)
   * confirmed the attestation before creating the request. Always true
   * on new requests; null on historical documents that predate this
   * field. */
  attestationAccepted: boolean | null;
  /** Timestamp when the attestation was accepted. Null for historical
   * documents or if attestation was not required. */
  attestationAcceptedAt: string | null;

  /** Operational dispatch priority — see `DispatchPriority` above.
   * Historical documents that predate this field default to "normal"
   * (see `toWaterRequest()` in waterRequests.ts). */
  dispatchPriority: DispatchPriority;
  /** How the current priority was established. */
  prioritySource: PrioritySource;
  /** Explains the current priority — either the system's initial
   * determination (see `determineInitialDispatchPriority` in
   * `priority.ts`) or the reason a dispatcher/admin gave when
   * overriding it. Null only for historical documents that predate
   * this field. */
  priorityReason: string | null;
  priorityUpdatedBy: string | null;
  priorityUpdatedAt: string | null;

  requestedAt: string;
  availableAt: string | null;
  claimedAt: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;

  createdAt: string;
  updatedAt: string;

  /**
   * Set when this request is currently part of a dispatcher-created
   * Batch Dispatch run (see TECHNICAL.md "Batch Dispatch"). Null for
   * every normal self-claimed or single-assigned request. A request
   * keeps this set through delivered/confirmed/disputed so the batch
   * remains a complete, reprintable record — it is only cleared when
   * the request is reassigned to a different driver or cancelled,
   * which detaches it from the batch's current membership.
   */
  dispatchBatchId: string | null;
  /** 1-based position within its batch's original run sheet. Null
   * whenever `dispatchBatchId` is null. */
  batchSequence: number | null;

  /**
   * Staff dispatch-override rank. Lower values sort ahead of higher
   * values within the same dispatch priority, letting authorized
   * dispatchers deliberately move an outstanding request ahead in the
   * queue without rewriting its original `requestedAt`. Null for the
   * vast majority of requests; `0` is the canonical value set when a
   * dispatcher escalates a request. See `escalateDispatchRequest()` and
   * `dispatchQueueCompare()`.
   */
  dispatchOverrideRank: number | null;
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
  | "delivery_auto_confirmed"
  | "dispute_resolved_completed"
  | "dispute_resolved_reopened"
  | "request_cancelled"
  | "dispatcher_assigned"
  | "dispatcher_reassigned"
  | "request_priority_changed"
  | "preferred_driver_bypassed_for_priority"
  | "preferred_driver_hold_released_for_priority"
  /** See TECHNICAL.md "Batch Dispatch". Deliberately distinct from
   * "dispatcher_assigned" so a batch assignment is never mistaken for
   * an ordinary single dispatcher assignment in the audit trail. */
  | "dispatcher_batch_assigned"
  /** Recorded when a request is reassigned to a different driver or
   * cancelled while still part of an active batch, detaching it from
   * that batch's current membership (see TECHNICAL.md "Batch
   * Dispatch"). The specific reassignment/cancellation is still
   * recorded separately via the existing "dispatcher_reassigned" /
   * "request_cancelled" event — this is additional context, not a
   * replacement. */
  | "dispatcher_batch_membership_removed"
  /** Staff-recorded delivery for a batch-assigned load whose driver
   * could not use the app (see PRODUCT.md / TECHNICAL.md "Batch
   * Dispatch"). Deliberately distinct from "marked_delivered" (a
   * driver's own action) so the audit trail never misrepresents a
   * staff paper-reconciliation entry as the driver's own action. */
  | "marked_delivered_by_dispatcher_batch"
  /** Staff-recorded delivery for a normal (non-batch) request whose
   * driver could not or did not mark it delivered through the driver
   * app. Distinct from "marked_delivered" (the driver's own action)
   * and from "marked_delivered_by_dispatcher_batch" (batch loads). */
  | "marked_delivered_by_dispatcher"
  /** Dispatcher/admin manual escalation that places a request ahead
   * in the dispatch queue. Records the previous and new override rank
   * and the reason. The original `requestedAt` is never changed. */
  | "dispatch_order_overridden";

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
  | "driver_cooldown_started"
  | "driver_registry_created"
  | "driver_registry_updated"
  | "driver_account_linked"
  | "driver_account_unlinked"
  | "meter_assignment_added"
  | "meter_assignment_updated"
  | "meter_assignment_removed";

export interface DriverEvent {
  id: string;
  type: DriverEventType;
  actorId: string | null;
  actorRole: UserRole | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Driver Registry (government-managed driver roster)
// ---------------------------------------------------------------------------

/**
 * A driver is a government-recognized entity, entered and managed by
 * staff — never self-created by a user account receiving the `driver`
 * role. A registry entry can exist entirely on its own before the
 * person ever creates or signs into an application account.
 *
 * Canonical driver ID strategy (see TECHNICAL.md "Driver Registry"):
 * `id` (this document's Firestore ID) identifies the driver as a
 * government entity for admin/meter/eligibility management. It is
 * NEVER stored as `waterRequests.assignedDriverId`/`preferredDriverId`
 * or `driverOffers.driverId` — those remain the linked user's Firebase
 * uid, because accepting/declining/claiming a delivery inherently
 * requires an authenticated session. `linkedUserId` is the bridge
 * between the two: operational code looks up a registry entry BY
 * `linkedUserId` to check eligibility/availability/cooldown for a given
 * authenticated driver.
 */
export interface DriverRegistryEntry {
  id: string;
  displayName: string;
  phone: string | null;

  /** Firebase uid of the linked application account, or null if unlinked. */
  linkedUserId: string | null;

  eligibilityStatus: DriverEligibilityStatus;
  availabilityStatus: DriverAvailabilityStatus;

  ineligibilityReason: string | null;
  restrictedAt: string | null;
  restrictedBy: string | null;

  /** Temporary dispatch-offer decline cooldown (future timestamp). */
  cooldownUntil: string | null;

  /**
   * Operational lock for the one-active-delivery invariant. Set to the
   * water request ID currently claimed by this driver; null when no
   * active delivery is assigned. This is the authoritative source for
   * whether a driver can be assigned another request atomically.
   */
  activeRequestId: string | null;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** Stable fill-station identifiers. New stations may be added later. */
export type FillStationId = "bottom" | "wws" | "hells-gate" | string;

export interface FillStation {
  id: FillStationId;
  name: string;
  active: boolean;
}

/**
 * A driver's meter assignment at one fill station. Only the operationally
 * useful meter code/number are stored — not full serial numbers.
 */
export interface MeterAssignment {
  stationId: FillStationId;
  meterCode: string;
  meterNumber: number;
  updatedAt: string;
  updatedBy: string;
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

// ---------------------------------------------------------------------------
// Batch Dispatch (dispatcher-controlled multi-load assignment)
// ---------------------------------------------------------------------------

/**
 * See PRODUCT.md / TECHNICAL.md "Batch Dispatch". This is a deliberate,
 * dispatcher-controlled EXCEPTION to the normal one-offer-at-a-time
 * driver dispatch model — used when staff need to preassign several
 * loads to one driver at once (e.g. for a driver whose phone/data
 * access is unreliable) and hand them a single printed run sheet.
 *
 * "active" means at least one of the batch's current member requests
 * is still `status: "claimed"` (not yet delivered). "completed" means
 * every current member has left "claimed" (delivered, confirmed,
 * disputed) or the batch currently has no members left (all were
 * reassigned/cancelled out of it). This is a maintained cache of a
 * value that could otherwise be recomputed from the member requests
 * themselves — see `computeDispatchBatchStatus()` in
 * `dispatchBatchSelection.ts` — kept in sync by every domain function
 * that can change a batch member's status or membership.
 */
export type DispatchBatchStatus = "active" | "completed";

export interface DispatchBatch {
  id: string;
  /** Firebase uid of the linked driver account this batch was assigned
   * to (never the driverRegistry document ID — see TECHNICAL.md
   * "Canonical Driver ID"). */
  driverId: string;
  /** uid of the dispatcher/admin who created this batch. */
  createdBy: string;
  createdAt: string;
  status: DispatchBatchStatus;
  /**
   * The full set of request IDs originally assigned when this batch
   * was created, in run-sheet order. Immutable historical record for
   * audit — NOT the live membership list. A request's CURRENT
   * membership is determined by `WaterRequest.dispatchBatchId`
   * pointing back at this batch (queryable directly), since a request
   * can leave the batch (reassigned to another driver, or cancelled)
   * without rewriting this array — see TECHNICAL.md "Batch Dispatch".
   */
  originalRequestIds: string[];
  /** Last time a run sheet was generated or reprinted for this batch,
   * or null if it has never been generated (should not normally
   * happen, since generation is part of the creation flow). */
  generatedAt: string | null;
  updatedAt: string;
}

export type DispatchBatchEventType =
  | "dispatch_batch_created"
  | "dispatch_batch_reprinted";

export interface DispatchBatchEvent {
  id: string;
  type: DispatchBatchEventType;
  actorId: string | null;
  actorRole: UserRole | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}
