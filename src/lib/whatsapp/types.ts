/**
 * Types for the resident WhatsApp ordering conversation — see
 * PRODUCT.md / TECHNICAL.md "WhatsApp Resident Ordering".
 *
 * WhatsApp is a front end to the existing application: this module
 * only models the CONVERSATION (what has been asked/answered so far).
 * It never becomes the source of truth for a water request — that
 * remains `waterRequests/{id}`, created via the same
 * `createWaterRequest()` used by the web app. See DEVIN.md "Do not
 * store authoritative application state inside WhatsApp conversations."
 */

import type {
  ReportedUrgency,
  VulnerableCircumstance,
  WaterRequest,
} from "@/lib/domain/types";

/**
 * Linear, deterministic conversation steps. No AI/intent
 * classification — every step expects a specific, narrow shape of
 * reply (a menu number, CONFIRM/CANCEL, etc.) and re-prompts on
 * anything else (see PRODUCT.md "Deterministic, Not AI").
 */
export type WhatsAppConversationStep =
  | "menu"
  | "confirm_profile"
  | "collect_name"
  | "collect_village"
  | "collect_directions"
  | "collect_phone"
  | "collect_persons_affected"
  | "collect_vulnerable"
  | "collect_storage"
  | "collect_urgency"
  | "collect_critical_explanation"
  | "collect_preferred_driver"
  | "confirm_request"
  | "confirm_delivery"
  | "collect_dispute_reason";

/**
 * Draft answers collected so far this conversation. Deliberately only
 * what's needed to build a `CreateWaterRequestInput` (or a delivery
 * confirmation/dispute) — no more personal data than necessary is kept
 * in session state (see PRODUCT.md "Session Privacy").
 */
export interface WhatsAppSessionDraft {
  displayName?: string;
  phone?: string;
  village?: string;
  deliveryDirections?: string;
  personsAffected?: number | null;
  vulnerableCircumstances?: VulnerableCircumstance[];
  availableStorageCapacity?: string | null;
  reportedUrgency?: ReportedUrgency;
  criticalExplanation?: string | null;
  /** Firebase uid of the preferred driver, or null for "no preference". */
  preferredDriverId?: string | null;
  /**
   * True when the resident is actively correcting their saved profile
   * (reached "confirm_profile" -> chose to update). When the edit
   * sequence completes, the orchestrator applies it via the existing
   * `updateUserProfile()` domain function — never a WhatsApp-specific
   * profile-write path.
   */
  editingProfile?: boolean;
  /** requestId under discussion for confirm_delivery / dispute steps. */
  activeRequestId?: string | null;
}

/**
 * "ambiguous" means more than one registered resident profile shares
 * this WhatsApp sender's phone number — per PRODUCT.md "Resident
 * Identity Strategy" we never guess which account to use in that case.
 */
export type WhatsAppCustomerType = "registered" | "unregistered" | "ambiguous" | "unknown";

export interface WhatsAppSession {
  /** Deterministic id derived from the normalized sender phone (see session.ts) — never the raw phone number itself, to avoid personal data in Firestore document paths. */
  id: string;
  /** Normalized (digits-only) sender phone number. */
  senderPhone: string;
  /** Firebase uid, once a registered resident has been matched. */
  customerId: string | null;
  customerType: WhatsAppCustomerType;
  step: WhatsAppConversationStep;
  draft: WhatsAppSessionDraft;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** A driver option presented in the preferred-driver menu. */
export interface WhatsAppDriverOption {
  uid: string;
  displayName: string;
}

/**
 * Everything the pure conversation reducer needs beyond the inbound
 * text and current session — all fetched by the (server-only)
 * orchestrator BEFORE calling the reducer, so the reducer itself never
 * touches Firestore/network and stays fully unit-testable.
 */
export interface WhatsAppConversationContext {
  now: Date;
  /** Only populated when relevant to the current step (menu selection, status check). */
  activeRequest: WaterRequest | null;
  /** Populated only when reaching the preferred-driver step. */
  eligibleDrivers: WhatsAppDriverOption[];
  /** Resident's saved profile snapshot, when customerType is "registered". */
  registeredProfile: {
    displayName: string;
    phone: string | null;
    village: string | null;
    deliveryDirections: string | null;
  } | null;
}

export type WhatsAppConversationAction =
  | {
      type: "create_request";
      customerId: string | null;
      customer: { displayName: string; phone: string; email: string | null } | null;
      village: string;
      deliveryDirections: string;
      preferredDriverId: string | null;
      waterSituation: {
        personsAffected: number | null;
        vulnerableCircumstances: VulnerableCircumstance[];
        availableStorageCapacity: string | null;
        reportedUrgency: ReportedUrgency;
        criticalExplanation: string | null;
      };
    }
  | {
      type: "update_profile";
      uid: string;
      displayName: string;
      phone: string | null;
      village: string;
      deliveryDirections: string;
    }
  | { type: "confirm_delivery"; requestId: string; customerId: string }
  | { type: "dispute_delivery"; requestId: string; customerId: string; reason: string };

export interface WhatsAppConversationResult {
  /** Next session state to persist (or null to end/reset the conversation). */
  session: WhatsAppSession | null;
  /** Outbound message(s) to send, in order. */
  outbound: string[];
  /**
   * Canonical domain action(s) for the orchestrator to execute, in
   * order (e.g. an "edit profile" confirmation returns both
   * `update_profile` and `create_request` — the resident's saved
   * profile is only ever updated on explicit confirmation, never from
   * ambiguous free text; see PRODUCT.md "Registered Resident Flow").
   */
  actions?: WhatsAppConversationAction[];
}
