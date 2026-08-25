import { describe, expect, it } from "vitest";

import { buildContinuityReportData } from "@/lib/domain/continuityReportData";
import type { StandardLoadGallons, WaterRequest } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

const baseTime = new Date("2026-08-20T12:00:00.000Z");
const generatedAt = new Date("2026-08-20T16:00:00.000Z"); // 4 hours later

function makeRequest(
  id: string,
  status: WaterRequest["status"],
  overrides: Partial<WaterRequest> = {},
): WaterRequest {
  return {
    id,
    customerId: "resident-1",
    customer: {
      displayName: "Jane Resident",
      phone: "+599-000-0001",
      email: null,
      isRegistered: true,
    },
    source: "resident",
    createdBy: null,
    gallons: 1000 as StandardLoadGallons,
    village: "Windwardside",
    deliveryDirections: "Blue gate, second driveway.",
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: null,
    status,
    waterSituation: {
      personsAffected: 4,
      vulnerableCircumstances: ["medical_need"],
      availableStorageCapacity: "About 500 gallons",
      reportedUrgency: "critical",
      criticalExplanation: "Resident is on dialysis and requires water daily.",
    },
    attestationAccepted: true,
    attestationAcceptedAt: baseTime.toISOString(),
    dispatchPriority: "normal",
    prioritySource: "system",
    priorityReason: null,
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: baseTime.toISOString(),
    availableAt: null,
    claimedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
    dispatchBatchId: null,
    batchSequence: null,
    ...overrides,
  };
}

const driverNames = new Map<string, string>([
  ["driver-1", "Earl Ballentyne"],
  ["driver-2", "Andy Lavia"],
]);

describe("buildContinuityReportData", () => {
  it("includes 'available' requests in the unassigned section", () => {
    const data = buildContinuityReportData(
      [makeRequest("r1", "available")],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned).toHaveLength(1);
    expect(data.unassigned[0].requestId).toBe("r1");
    expect(data.assigned).toHaveLength(0);
  });

  it("includes 'preferred_driver_hold' requests in the unassigned section, with preferred driver name", () => {
    const data = buildContinuityReportData(
      [
        makeRequest("r2", "preferred_driver_hold", {
          preferredDriverId: "driver-1",
        }),
      ],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned).toHaveLength(1);
    expect(data.unassigned[0].preferredDriverName).toBe("Earl Ballentyne");
  });

  it("includes 'claimed' requests in the assigned section, with assigned driver name", () => {
    const data = buildContinuityReportData(
      [
        makeRequest("r3", "claimed", {
          assignedDriverId: "driver-2",
          claimedAt: baseTime.toISOString(),
        }),
      ],
      driverNames,
      generatedAt,
    );
    expect(data.assigned).toHaveLength(1);
    expect(data.assigned[0].assignedDriverName).toBe("Andy Lavia");
    expect(data.assigned[0].claimedAt).toBe(baseTime.toISOString());
    expect(data.unassigned).toHaveLength(0);
  });

  it("flags a batch-assigned 'claimed' request as isBatchAssigned, and a normal claim as not", () => {
    const data = buildContinuityReportData(
      [
        makeRequest("batch-load", "claimed", {
          assignedDriverId: "driver-1",
          dispatchBatchId: "batch-123",
          batchSequence: 1,
        }),
        makeRequest("normal-claim", "claimed", { assignedDriverId: "driver-2" }),
      ],
      driverNames,
      generatedAt,
    );
    const batchRow = data.assigned.find((r) => r.requestId === "batch-load");
    const normalRow = data.assigned.find((r) => r.requestId === "normal-claim");
    expect(batchRow?.isBatchAssigned).toBe(true);
    expect(normalRow?.isBatchAssigned).toBe(false);
  });

  it("excludes 'delivered' requests entirely", () => {
    const data = buildContinuityReportData(
      [makeRequest("r4", "delivered", { deliveredAt: baseTime.toISOString() })],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned).toHaveLength(0);
    expect(data.assigned).toHaveLength(0);
  });

  it("excludes 'confirmed' requests entirely", () => {
    const data = buildContinuityReportData(
      [makeRequest("r5", "confirmed", { confirmedAt: baseTime.toISOString() })],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned).toHaveLength(0);
    expect(data.assigned).toHaveLength(0);
  });

  it("excludes 'cancelled' requests entirely", () => {
    const data = buildContinuityReportData(
      [makeRequest("r6", "cancelled")],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned).toHaveLength(0);
    expect(data.assigned).toHaveLength(0);
  });

  it("resolves correct driver/customer names", () => {
    const data = buildContinuityReportData(
      [
        makeRequest("r7", "claimed", {
          assignedDriverId: "driver-1",
          customer: {
            displayName: "Tom Customer",
            phone: "+599-000-0099",
            email: null,
            isRegistered: true,
          },
        }),
      ],
      driverNames,
      generatedAt,
    );
    expect(data.assigned[0].customerName).toBe("Tom Customer");
    expect(data.assigned[0].assignedDriverName).toBe("Earl Ballentyne");
  });

  it("computes correct Saba timestamps (formattable via formatSabaDateTime)", () => {
    const data = buildContinuityReportData(
      [makeRequest("r8", "available")],
      driverNames,
      generatedAt,
    );
    expect(data.generatedAt).toBe(generatedAt.toISOString());
    expect(formatSabaDateTime(data.unassigned[0].requestedAt)).toBe(
      formatSabaDateTime(baseTime.toISOString()),
    );
    // 4 hours between requestedAt and generatedAt in the fixtures above.
    expect(data.unassigned[0].ageMinutes).toBe(240);
  });

  it("never includes sensitive circumstance details (waterSituation) in report rows", () => {
    const data = buildContinuityReportData(
      [makeRequest("r9", "available"), makeRequest("r10", "claimed", { assignedDriverId: "driver-1" })],
      driverNames,
      generatedAt,
    );
    for (const row of [...data.unassigned, ...data.assigned]) {
      expect(row).not.toHaveProperty("waterSituation");
      expect(row).not.toHaveProperty("vulnerableCircumstances");
      expect(row).not.toHaveProperty("criticalExplanation");
      expect(row).not.toHaveProperty("personsAffected");
    }
  });

  it("orders by priority then age within each section", () => {
    const data = buildContinuityReportData(
      [
        makeRequest("normal-old", "available", {
          dispatchPriority: "normal",
          requestedAt: new Date("2026-08-20T10:00:00.000Z").toISOString(),
        }),
        makeRequest("critical-new", "available", {
          dispatchPriority: "critical",
          requestedAt: new Date("2026-08-20T11:00:00.000Z").toISOString(),
        }),
        makeRequest("critical-old", "available", {
          dispatchPriority: "critical",
          requestedAt: new Date("2026-08-20T09:00:00.000Z").toISOString(),
        }),
      ],
      driverNames,
      generatedAt,
    );
    expect(data.unassigned.map((r) => r.requestId)).toEqual([
      "critical-old",
      "critical-new",
      "normal-old",
    ]);
  });
});
