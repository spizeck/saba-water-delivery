/**
 * Centralized audit/event detail formatter.
 *
 * Transforms raw audit event metadata into a human-readable detail
 * string for display in Event History UI. Each event type has
 * purpose-built formatting that:
 * - Shows relevant information in a logical order
 * - Resolves UIDs to display names via the provided nameMap
 * - Hides redundant fields (e.g. fillStationId when fillStationName exists)
 * - Hides null/undefined/empty/default values
 * - Humanizes field names and enum values
 * - Falls back gracefully for unknown event types
 *
 * This module is purely presentational — it never modifies stored data.
 */

import type { WaterRequestEventType } from "@/lib/domain/types";
import type { DriverEventType } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormatEventOptions {
  /** Map of UIDs → display names for resolving IDs to human-readable names. */
  nameMap?: Record<string, string>;
  /** The actorId from the parent event (to avoid repeating the actor in details). */
  actorId?: string | null;
}

/**
 * Formats a water request event's metadata into a human-readable string.
 * Returns null if there is nothing meaningful to display.
 */
export function formatRequestEventDetails(
  type: WaterRequestEventType | string,
  metadata: Record<string, unknown> | null,
  options: FormatEventOptions = {},
): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  const formatter = REQUEST_EVENT_FORMATTERS[type as WaterRequestEventType];
  if (formatter) {
    const result = formatter(metadata, options);
    return result || null;
  }

  return formatFallback(metadata, options);
}

/**
 * Formats a driver registry event's metadata into a human-readable string.
 * Returns null if there is nothing meaningful to display.
 */
export function formatDriverEventDetails(
  type: DriverEventType | string,
  metadata: Record<string, unknown> | null,
  options: FormatEventOptions = {},
): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  const formatter = DRIVER_EVENT_FORMATTERS[type as DriverEventType];
  if (formatter) {
    const result = formatter(metadata, options);
    return result || null;
  }

  return formatFallback(metadata, options);
}

// ---------------------------------------------------------------------------
// Event title overrides (for cleaner labels)
// ---------------------------------------------------------------------------

export const REQUEST_EVENT_LABELS: Record<string, string> = {
  request_created: "Request created",
  request_created_by_dispatcher: "Request created by staff",
  preferred_driver_selected: "Preferred driver selected",
  preferred_driver_expired: "Preferred driver hold expired",
  preferred_driver_declined: "Preferred driver declined",
  request_opened: "Opened to queue",
  driver_claimed: "Driver claimed",
  marked_delivered: "Marked delivered",
  customer_confirmed: "Customer confirmed",
  delivery_confirmed_by_dispatcher: "Delivery confirmed by staff",
  customer_disputed: "Customer disputed",
  delivery_auto_confirmed: "Auto-confirmed (no response within window)",
  dispute_resolved_completed: "Dispute resolved (completed)",
  dispute_resolved_reopened: "Dispute resolved (reopened)",
  request_cancelled: "Request cancelled",
  dispatcher_assigned: "Dispatcher assigned",
  dispatcher_reassigned: "Dispatcher reassigned",
  request_returned_to_queue: "Returned to dispatch queue",
  request_priority_changed: "Priority changed",
  preferred_driver_bypassed_for_priority: "Preferred driver bypassed (priority)",
  preferred_driver_hold_released_for_priority: "Preferred driver hold released (priority)",
  dispatcher_batch_assigned: "Assigned via delivery run",
  dispatcher_batch_membership_removed: "Removed from delivery run",
  marked_delivered_by_dispatcher_batch: "Delivery recorded (run reconciliation)",
  marked_delivered_by_dispatcher: "Delivery recorded by staff",
  dispatch_order_overridden: "Dispatch order overridden",
  water_collected: "Water collected",
  water_collected_by_staff: "Water collection recorded",
  customer_history_linked: "Request linked to account",
  request_edited: "Request edited",
};

export const DRIVER_EVENT_LABELS: Record<string, string> = {
  driver_online: "Went online",
  driver_offline: "Went offline",
  driver_access_restricted: "Delivery access restricted",
  driver_access_restored: "Delivery access restored",
  driver_cooldown_started: "Decline cooldown started",
  driver_registry_created: "Added to registry",
  driver_registry_updated: "Details updated",
  driver_account_linked: "Account linked",
  driver_account_unlinked: "Account unlinked",
  meter_assignment_added: "Meter assignment added",
  meter_assignment_updated: "Meter assignment updated",
  meter_assignment_removed: "Meter assignment removed",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveName(id: unknown, options: FormatEventOptions): string | null {
  if (typeof id !== "string" || !id) return null;
  return options.nameMap?.[id] ?? null;
}

function resolveNameOrId(id: unknown, options: FormatEventOptions): string | null {
  if (typeof id !== "string" || !id) return null;
  return options.nameMap?.[id] ?? id;
}

function formatPriority(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const labels: Record<string, string> = {
    normal: "Normal",
    urgent: "Urgent",
    critical: "Critical",
  };
  return labels[value] ?? capitalize(value);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function formatGallons(value: unknown): string | null {
  if (typeof value !== "number") return null;
  return `${value.toLocaleString()} gallons`;
}

function formatLoads(value: unknown): string | null {
  if (typeof value !== "number") return null;
  return `${value} load${value !== 1 ? "s" : ""}`;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined || value === "" || value === "null";
}

function isDefaultOrRoutine(key: string, value: unknown): boolean {
  if (isNullish(value)) return true;
  // Hide common implementation-only fields
  if (key === "isRegisteredCustomer") return true;
  if (key === "prioritySource" && value === "system") return true;
  if (key === "priorityRank") return true;
  return false;
}

/** Humanizes a camelCase or snake_case key for unknown/fallback fields. */
function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function humanizeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Segment builder
// ---------------------------------------------------------------------------

type Segment = string;

function join(segments: (Segment | null | undefined | false)[]): string {
  return segments.filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Request event formatters
// ---------------------------------------------------------------------------

type EventFormatter = (
  metadata: Record<string, unknown>,
  options: FormatEventOptions,
) => string;

const REQUEST_EVENT_FORMATTERS: Record<WaterRequestEventType, EventFormatter | undefined> = {
  request_created: (m, o) => {
    const parts: (string | null)[] = [];
    parts.push(formatLoads(m.loads));
    parts.push(formatGallons(m.gallons));
    if (m.village) parts.push(String(m.village));
    if (m.preferredDriverId && !isNullish(m.preferredDriverId)) {
      const name = resolveName(m.preferredDriverId, o);
      parts.push(name ? `Preferred: ${name}` : `Preferred driver selected`);
    }
    if (m.dispatchPriority && m.dispatchPriority !== "normal") {
      parts.push(`Priority: ${formatPriority(m.dispatchPriority)}`);
      if (m.priorityReason) parts.push(String(m.priorityReason));
    }
    return join(parts);
  },

  request_created_by_dispatcher: (m, o) => {
    // Same format as request_created
    return REQUEST_EVENT_FORMATTERS.request_created!(m, o);
  },

  preferred_driver_selected: (m, o) => {
    const parts: (string | null)[] = [];
    const name = resolveName(m.driverId, o);
    if (name) parts.push(`Driver: ${name}`);
    if (m.expiresAt) parts.push(`Hold expires: ${formatDatetimeValue(m.expiresAt)}`);
    return join(parts);
  },

  preferred_driver_expired: (m, o) => {
    const name = resolveName(m.driverId, o);
    return name ? `Driver: ${name}` : "";
  },

  preferred_driver_declined: (m, o) => {
    const name = resolveName(m.driverId, o);
    return name ? `Driver: ${name}` : "";
  },

  preferred_driver_bypassed_for_priority: (m, o) => {
    const parts: (string | null)[] = [];
    const name = resolveName(m.driverId, o);
    if (name) parts.push(`Driver: ${name}`);
    if (m.dispatchPriority) parts.push(`Priority: ${formatPriority(m.dispatchPriority)}`);
    return join(parts);
  },

  preferred_driver_hold_released_for_priority: (m, o) => {
    const parts: (string | null)[] = [];
    const name = resolveName(m.driverId, o);
    if (name) parts.push(`Driver: ${name}`);
    if (m.newPriority) parts.push(`New priority: ${formatPriority(m.newPriority)}`);
    return join(parts);
  },

  request_opened: () => "",

  driver_claimed: (m, o) => {
    // The actor line already shows who claimed, but if there's a specific
    // driverId in metadata that differs from actorId, show it
    if (m.driverId && m.driverId !== o.actorId) {
      const name = resolveName(m.driverId, o);
      if (name) return `Driver: ${name}`;
    }
    return "";
  },

  marked_delivered: () => "",

  marked_delivered_by_dispatcher: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.driverId && m.driverId !== o.actorId) {
      const name = resolveName(m.driverId, o);
      if (name) parts.push(`Driver: ${name}`);
    }
    if (m.note) parts.push(`Note: ${m.note}`);
    return join(parts);
  },

  marked_delivered_by_dispatcher_batch: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.driverId && m.driverId !== o.actorId) {
      const name = resolveName(m.driverId, o);
      if (name) parts.push(`Driver: ${name}`);
    }
    if (m.note) parts.push(`Note: ${m.note}`);
    return join(parts);
  },

  customer_confirmed: () => "",
  delivery_confirmed_by_dispatcher: () => "",
  delivery_auto_confirmed: () => "",

  customer_disputed: (m) => {
    if (m.reason) return `Reason: ${m.reason}`;
    return "";
  },

  dispute_resolved_completed: (m) => {
    if (m.note || m.reason) return `Note: ${m.note ?? m.reason}`;
    return "";
  },

  dispute_resolved_reopened: (m) => {
    if (m.note || m.reason) return `Note: ${m.note ?? m.reason}`;
    return "";
  },

  request_cancelled: (m) => {
    const parts: (string | null)[] = [];
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    if (m.previousStatus) parts.push(`Previous status: ${capitalize(String(m.previousStatus))}`);
    return join(parts);
  },

  dispatcher_assigned: (m, o) => {
    const name = resolveName(m.driverId, o);
    return name ? `Assigned to: ${name}` : "";
  },

  dispatcher_reassigned: (m, o) => {
    const parts: (string | null)[] = [];
    const prevName = resolveName(m.previousDriverId, o);
    const newName = resolveName(m.newDriverId ?? m.driverId, o);
    if (prevName) parts.push(`From: ${prevName}`);
    if (newName) parts.push(`To: ${newName}`);
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    return join(parts);
  },

  request_returned_to_queue: (m, o) => {
    const parts: (string | null)[] = [];
    const previousDriver = resolveName(m.previousDriverId, o);
    if (previousDriver) parts.push(`Previous driver: ${previousDriver}`);
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    return join(parts);
  },

  request_priority_changed: (m) => {
    const parts: (string | null)[] = [];
    if (m.previousPriority) parts.push(`From: ${formatPriority(m.previousPriority)}`);
    if (m.newPriority) parts.push(`To: ${formatPriority(m.newPriority)}`);
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    return join(parts);
  },

  dispatcher_batch_assigned: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.driverId) {
      const name = resolveName(m.driverId, o);
      if (name) parts.push(`Driver: ${name}`);
    }
    if (m.batchId) parts.push(`Run: ${m.batchId}`);
    return join(parts);
  },

  dispatcher_batch_membership_removed: (m) => {
    if (m.reason) return `Reason: ${m.reason}`;
    return "";
  },

  dispatch_order_overridden: (m) => {
    const parts: (string | null)[] = [];
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    if (m.previousRank != null && m.newRank != null) {
      parts.push(`Rank: ${m.previousRank} → ${m.newRank}`);
    }
    return join(parts);
  },

  water_collected: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.loadNumber) parts.push(`Load ${m.loadNumber}`);
    if (m.fillStationName) parts.push(String(m.fillStationName));
    if (m.meterCode) parts.push(`Meter ${m.meterCode}`);
    else if (m.meterNumber) parts.push(`Meter ${m.meterNumber}`);
    // Show driver name only if different from the event actor
    if (m.driverId && m.driverId !== o.actorId) {
      const name = resolveName(m.driverId, o);
      if (name) parts.push(`Driver: ${name}`);
    }
    if (m.note) parts.push(`Note: ${m.note}`);
    return join(parts);
  },

  water_collected_by_staff: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.loadNumber) parts.push(`Load ${m.loadNumber}`);
    if (m.fillStationName) parts.push(String(m.fillStationName));
    if (m.meterCode) parts.push(`Meter ${m.meterCode}`);
    else if (m.meterNumber) parts.push(`Meter ${m.meterNumber}`);
    // For staff-recorded events, always show the driver
    if (m.driverId) {
      const name = resolveName(m.driverId, o);
      if (name) parts.push(`Driver: ${name}`);
    }
    if (m.note) parts.push(`Note: ${m.note}`);
    return join(parts);
  },

  customer_history_linked: (m, o) => {
    const parts: (string | null)[] = [];
    if (m.targetUid) {
      const name = resolveName(m.targetUid, o);
      if (name) parts.push(`Linked to: ${name}`);
    }
    if (m.reason) parts.push(`Reason: ${m.reason}`);
    return join(parts);
  },

  request_edited: (m) => {
    const parts: (string | null)[] = [];
    // Show each changed field with before/after
    const fieldLabels: Record<string, string> = {
      village: "Village",
      deliveryDirections: "Directions",
      loads: "Loads",
      gallons: "Gallons",
      customerDisplayName: "Customer name",
      customerPhone: "Customer phone",
      customerEmail: "Customer email",
    };
    for (const [key, label] of Object.entries(fieldLabels)) {
      const prevKey = `previous${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      const newKey = `new${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      if (m[prevKey] !== undefined || m[newKey] !== undefined) {
        const prev = m[prevKey];
        const next = m[newKey];
        if (prev != null && next != null) {
          parts.push(`${label}: ${prev} → ${next}`);
        } else if (next != null) {
          parts.push(`${label}: ${next}`);
        }
      }
    }
    if (parts.length === 0) {
      for (const [field, rawChange] of Object.entries(m)) {
        const change = rawChange as { from?: unknown; to?: unknown };
        if (!change || typeof change !== "object" || (!("from" in change) && !("to" in change))) continue;
        const label = fieldLabels[field] ?? humanizeKey(field);
        parts.push(`${label}: ${humanizeValue(change.from ?? "—")} → ${humanizeValue(change.to ?? "—")}`);
      }
    }
    // Also handle the generic "changes" pattern if present
    if (parts.length === 0 && m.changes) {
      const changes = m.changes as Record<string, { previous?: unknown; new?: unknown }>;
      for (const [field, change] of Object.entries(changes)) {
        const label = fieldLabels[field] ?? humanizeKey(field);
        if (change.previous != null && change.new != null) {
          parts.push(`${label}: ${change.previous} → ${change.new}`);
        } else if (change.new != null) {
          parts.push(`${label}: ${change.new}`);
        }
      }
    }
    return join(parts);
  },
};

// ---------------------------------------------------------------------------
// Driver event formatters
// ---------------------------------------------------------------------------

const DRIVER_EVENT_FORMATTERS: Record<DriverEventType, EventFormatter | undefined> = {
  driver_online: () => "",
  driver_offline: () => "",

  driver_access_restricted: (m) => {
    if (m.reason) return `Reason: ${m.reason}`;
    return "";
  },

  driver_access_restored: (m) => {
    if (m.reason) return `Reason: ${m.reason}`;
    return "";
  },

  driver_cooldown_started: (m) => {
    const parts: (string | null)[] = [];
    if (m.declineCount) parts.push(`Declines: ${m.declineCount}`);
    if (m.cooldownHours) parts.push(`Cooldown: ${m.cooldownHours}h`);
    if (m.expiresAt) parts.push(`Until: ${formatDatetimeValue(m.expiresAt)}`);
    return join(parts);
  },

  driver_registry_created: (m) => {
    if (m.displayName) return String(m.displayName);
    return "";
  },

  driver_registry_updated: (m) => {
    const parts: (string | null)[] = [];
    if (m.displayName) parts.push(`Name: ${m.displayName}`);
    if (m.vehiclePlate) parts.push(`Plate: ${m.vehiclePlate}`);
    return join(parts);
  },

  driver_account_linked: (m, o) => {
    const name = resolveName(m.linkedUserId, o);
    return name ? `Linked to: ${name}` : "";
  },

  driver_account_unlinked: (m, o) => {
    const name = resolveName(m.previousLinkedUserId ?? m.linkedUserId, o);
    return name ? `Unlinked from: ${name}` : "";
  },

  meter_assignment_added: (m) => {
    const parts: (string | null)[] = [];
    if (m.stationName ?? m.fillStationName) parts.push(String(m.stationName ?? m.fillStationName));
    if (m.meterCode) parts.push(`Meter: ${m.meterCode}`);
    return join(parts);
  },

  meter_assignment_updated: (m) => {
    const parts: (string | null)[] = [];
    if (m.stationName ?? m.fillStationName) parts.push(String(m.stationName ?? m.fillStationName));
    if (m.meterCode) parts.push(`Meter: ${m.meterCode}`);
    return join(parts);
  },

  meter_assignment_removed: (m) => {
    const parts: (string | null)[] = [];
    if (m.stationName ?? m.fillStationName) parts.push(String(m.stationName ?? m.fillStationName));
    if (m.meterCode) parts.push(`Meter: ${m.meterCode}`);
    return join(parts);
  },
};

// ---------------------------------------------------------------------------
// Fallback formatter for unknown event types
// ---------------------------------------------------------------------------

function formatFallback(
  metadata: Record<string, unknown>,
  options: FormatEventOptions,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    if (isDefaultOrRoutine(key, value)) continue;
    // Skip IDs that have a name-resolved counterpart
    if (key.endsWith("Id") && typeof value === "string") {
      const nameKey = key.replace(/Id$/, "Name");
      if (metadata[nameKey]) continue; // The Name field will be shown instead
      const resolved = resolveNameOrId(value, options);
      if (resolved && resolved !== value) {
        parts.push(`${humanizeKey(key.replace(/Id$/, ""))}: ${resolved}`);
        continue;
      }
      // If it looks like a UID (long alphanumeric), skip it
      if (value.length > 20) continue;
    }
    // Skip Name fields if the base key has an ID counterpart we already resolved
    if (key.endsWith("Name") && typeof value === "string") {
      parts.push(`${humanizeKey(key.replace(/Name$/, ""))}: ${value}`);
      continue;
    }
    // Skip known implementation-only fields
    if (key === "overrodeDuplicateWarningFor") continue;

    parts.push(`${humanizeKey(key)}: ${humanizeValue(value)}`);
  }

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Date formatting helper (for inline datetime values in metadata)
// ---------------------------------------------------------------------------

function formatDatetimeValue(value: unknown): string {
  if (typeof value !== "string") return String(value);
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}
