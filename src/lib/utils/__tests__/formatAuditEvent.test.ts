import { describe, expect, it } from "vitest";

import {
  formatRequestEventDetails,
  formatDriverEventDetails,
  REQUEST_EVENT_LABELS,
  DRIVER_EVENT_LABELS,
} from "../formatAuditEvent";

const nameMap: Record<string, string> = {
  "driver-uid-1": "Demo Driver",
  "staff-uid-1": "Office Staff",
  "resident-uid-1": "Jane Resident",
  "7LOoA8IQ1PVlwGijBTDjGjBDqup2": "Demo Driver",
  "LvDp8wCgUcPZBbNoOmI8w3K4r2u1": "Office Staff",
};

describe("formatRequestEventDetails", () => {
  describe("request_created", () => {
    it("formats loads, gallons, village, and hides normal priority", () => {
      const result = formatRequestEventDetails("request_created", {
        loads: 2,
        gallons: 2000,
        village: "Zions Hill - Lower",
        preferredDriverId: null,
        isRegisteredCustomer: true,
        dispatchPriority: "normal",
        priorityReason: "No critical indicators reported.",
      });
      expect(result).toBe("2 loads · 2,000 gallons · Zions Hill - Lower");
    });

    it("shows priority for urgent/critical requests", () => {
      const result = formatRequestEventDetails("request_created", {
        loads: 1,
        gallons: 1000,
        village: "The Bottom",
        dispatchPriority: "critical",
        priorityReason: "Elderly person with no water for 3 days",
      });
      expect(result).toContain("Priority: Critical");
      expect(result).toContain("Elderly person with no water for 3 days");
    });

    it("shows preferred driver name when available", () => {
      const result = formatRequestEventDetails("request_created", {
        loads: 1,
        gallons: 1000,
        village: "St Johns",
        preferredDriverId: "driver-uid-1",
        dispatchPriority: "normal",
      }, { nameMap });
      expect(result).toContain("Preferred: Demo Driver");
    });

    it("hides null preferredDriverId", () => {
      const result = formatRequestEventDetails("request_created", {
        loads: 1,
        gallons: 1000,
        village: "St Johns",
        preferredDriverId: null,
        dispatchPriority: "normal",
      });
      expect(result).not.toContain("Preferred");
      expect(result).not.toContain("null");
    });

    it("hides isRegisteredCustomer field", () => {
      const result = formatRequestEventDetails("request_created", {
        loads: 1,
        gallons: 1000,
        village: "St Johns",
        isRegisteredCustomer: true,
        dispatchPriority: "normal",
      });
      expect(result).not.toContain("isRegisteredCustomer");
      expect(result).not.toContain("Registered");
    });
  });

  describe("water_collected", () => {
    it("formats load, station, meter, and driver name", () => {
      const result = formatRequestEventDetails("water_collected", {
        loadNumber: 1,
        fillStationId: "bottom",
        fillStationName: "Bottom Fill Station",
        meterCode: "42",
        meterNumber: 42,
        driverId: "7LOoA8IQ1PVlwGijBTDjGjBDqup2",
      }, { nameMap, actorId: "7LOoA8IQ1PVlwGijBTDjGjBDqup2" });
      expect(result).toBe("Load 1 · Bottom Fill Station · Meter 42");
    });

    it("hides driver name when same as actor", () => {
      const result = formatRequestEventDetails("water_collected", {
        loadNumber: 1,
        fillStationName: "Bottom Fill Station",
        meterCode: "BTM2",
        driverId: "driver-uid-1",
      }, { nameMap, actorId: "driver-uid-1" });
      expect(result).not.toContain("Driver:");
    });

    it("shows driver name when different from actor", () => {
      const result = formatRequestEventDetails("water_collected", {
        loadNumber: 1,
        fillStationName: "Bottom Fill Station",
        meterCode: "BTM2",
        driverId: "driver-uid-1",
      }, { nameMap, actorId: "staff-uid-1" });
      expect(result).toContain("Driver: Demo Driver");
    });
  });

  describe("water_collected_by_staff", () => {
    it("shows driver name and note", () => {
      const result = formatRequestEventDetails("water_collected_by_staff", {
        loadNumber: 1,
        fillStationId: "bottom",
        fillStationName: "Bottom Fill Station",
        meterCode: "42",
        meterNumber: 42,
        driverId: "7LOoA8IQ1PVlwGijBTDjGjBDqup2",
        note: "paper",
      }, { nameMap, actorId: "LvDp8wCgUcPZBbNoOmI8w3K4r2u1" });
      expect(result).toBe("Load 1 · Bottom Fill Station · Meter 42 · Driver: Demo Driver · Note: paper");
    });
  });

  describe("request_priority_changed", () => {
    it("shows from/to/reason", () => {
      const result = formatRequestEventDetails("request_priority_changed", {
        previousPriority: "normal",
        newPriority: "urgent",
        reason: "Resident has been waiting 5 days",
      });
      expect(result).toBe("From: Normal · To: Urgent · Reason: Resident has been waiting 5 days");
    });
  });

  describe("dispatcher_assigned", () => {
    it("resolves driver name", () => {
      const result = formatRequestEventDetails("dispatcher_assigned", {
        driverId: "driver-uid-1",
      }, { nameMap });
      expect(result).toBe("Assigned to: Demo Driver");
    });
  });

  describe("dispatcher_reassigned", () => {
    it("shows from/to with resolved names", () => {
      const result = formatRequestEventDetails("dispatcher_reassigned", {
        previousDriverId: "driver-uid-1",
        newDriverId: "staff-uid-1",
        reason: "Driver unavailable",
      }, { nameMap });
      expect(result).toBe("From: Demo Driver · To: Office Staff · Reason: Driver unavailable");
    });
  });

  describe("request_cancelled", () => {
    it("shows reason and previous status", () => {
      const result = formatRequestEventDetails("request_cancelled", {
        reason: "Duplicate request",
        previousStatus: "available",
      });
      expect(result).toBe("Reason: Duplicate request · Previous status: Available");
    });
  });

  describe("customer_disputed", () => {
    it("shows dispute reason", () => {
      const result = formatRequestEventDetails("customer_disputed", {
        reason: "Water was not delivered",
      });
      expect(result).toBe("Reason: Water was not delivered");
    });
  });

  describe("events with empty/no metadata", () => {
    it("returns null for null metadata", () => {
      expect(formatRequestEventDetails("marked_delivered", null)).toBeNull();
    });

    it("returns null for empty metadata", () => {
      expect(formatRequestEventDetails("marked_delivered", {})).toBeNull();
    });

    it("returns null for events with no meaningful details", () => {
      expect(formatRequestEventDetails("customer_confirmed", { something: null })).toBeNull();
    });
  });

  describe("request_edited", () => {
    it("shows field changes with before/after", () => {
      const result = formatRequestEventDetails("request_edited", {
        previousVillage: "St Johns",
        newVillage: "The Bottom",
        previousLoads: 1,
        newLoads: 2,
      });
      expect(result).toContain("Village: St Johns → The Bottom");
      expect(result).toContain("Loads: 1 → 2");
    });
  });

  describe("fallback for unknown event types", () => {
    it("humanizes field names for unknown events", () => {
      const result = formatRequestEventDetails("unknown_future_event" as never, {
        someField: "value",
        nullField: null,
      });
      expect(result).toContain("Some Field: value");
      expect(result).not.toContain("nullField");
      expect(result).not.toContain("null");
    });

    it("resolves IDs via nameMap in fallback", () => {
      const result = formatRequestEventDetails("unknown_future_event" as never, {
        driverId: "driver-uid-1",
      }, { nameMap });
      expect(result).toContain("Demo Driver");
    });

    it("hides IDs when fillStationName exists", () => {
      const result = formatRequestEventDetails("unknown_future_event" as never, {
        fillStationId: "bottom",
        fillStationName: "Bottom Fill Station",
      });
      expect(result).not.toContain("bottom");
      expect(result).toContain("Bottom Fill Station");
    });
  });
});

describe("formatDriverEventDetails", () => {
  describe("meter_assignment_added", () => {
    it("shows station name and meter code", () => {
      const result = formatDriverEventDetails("meter_assignment_added", {
        stationName: "Bottom Fill Station",
        meterCode: "BTM2",
        stationId: "bottom",
      });
      expect(result).toBe("Bottom Fill Station · Meter: BTM2");
    });
  });

  describe("driver_cooldown_started", () => {
    it("shows decline count and cooldown hours", () => {
      const result = formatDriverEventDetails("driver_cooldown_started", {
        declineCount: 3,
        cooldownHours: 4,
      });
      expect(result).toBe("Declines: 3 · Cooldown: 4h");
    });
  });

  describe("driver_account_linked", () => {
    it("resolves linked user name", () => {
      const result = formatDriverEventDetails("driver_account_linked", {
        linkedUserId: "resident-uid-1",
      }, { nameMap });
      expect(result).toBe("Linked to: Jane Resident");
    });
  });

  describe("simple events with no details", () => {
    it("returns null for driver_online", () => {
      const result = formatDriverEventDetails("driver_online", {});
      expect(result).toBeNull();
    });

    it("returns null for driver_offline", () => {
      const result = formatDriverEventDetails("driver_offline", {});
      expect(result).toBeNull();
    });
  });
});

describe("EVENT_LABELS completeness", () => {
  it("REQUEST_EVENT_LABELS covers all known request event types", () => {
    const knownTypes = [
      "request_created", "request_created_by_dispatcher",
      "preferred_driver_selected", "preferred_driver_expired",
      "preferred_driver_declined", "request_opened",
      "driver_claimed", "marked_delivered",
      "customer_confirmed", "delivery_confirmed_by_dispatcher",
      "customer_disputed", "delivery_auto_confirmed",
      "dispute_resolved_completed", "dispute_resolved_reopened",
      "request_cancelled", "dispatcher_assigned",
      "dispatcher_reassigned", "request_priority_changed",
      "preferred_driver_bypassed_for_priority",
      "preferred_driver_hold_released_for_priority",
      "dispatcher_batch_assigned", "dispatcher_batch_membership_removed",
      "marked_delivered_by_dispatcher_batch", "marked_delivered_by_dispatcher",
      "dispatch_order_overridden", "water_collected",
      "water_collected_by_staff", "customer_history_linked",
      "request_edited",
    ];
    for (const type of knownTypes) {
      expect(REQUEST_EVENT_LABELS[type]).toBeDefined();
    }
  });

  it("DRIVER_EVENT_LABELS covers all known driver event types", () => {
    const knownTypes = [
      "driver_online", "driver_offline",
      "driver_access_restricted", "driver_access_restored",
      "driver_cooldown_started", "driver_registry_created",
      "driver_registry_updated", "driver_account_linked",
      "driver_account_unlinked", "meter_assignment_added",
      "meter_assignment_updated", "meter_assignment_removed",
    ];
    for (const type of knownTypes) {
      expect(DRIVER_EVENT_LABELS[type]).toBeDefined();
    }
  });
});
