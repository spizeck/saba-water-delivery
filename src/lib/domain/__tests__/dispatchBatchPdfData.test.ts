import { describe, expect, it } from "vitest";

import { buildDispatchBatchPdfData } from "@/lib/domain/dispatchBatchPdfData";
import type { StandardLoadGallons, WaterRequest } from "@/lib/domain/types";

const baseTime = new Date("2026-08-20T12:00:00.000Z");
const generatedAt = new Date("2026-08-20T14:30:00.000Z"); // 2h30m later

function makeRequest(overrides: Partial<WaterRequest> = {}): WaterRequest {
  return {
    id: "req-1",
    customerId: "resident-1",
    customer: {
      displayName: "Jane Resident",
      phone: "+599-000-0001",
      email: "jane@example.com",
      isRegistered: true,
    },
    source: "resident",
    createdBy: null,
    loads: 1,
    gallons: 1000 as StandardLoadGallons,
    village: "Windwardside",
    deliveryDirections: "Blue gate, second driveway.",
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: "driver-1",
    status: "claimed",
    waterSituation: {
      personsAffected: 4,
      vulnerableCircumstances: ["medical_need"],
      availableStorageCapacity: "About 500 gallons",
      reportedUrgency: "critical",
      criticalExplanation: "Resident is on dialysis and requires water daily.",
    },
    attestationAccepted: true,
    attestationAcceptedAt: baseTime.toISOString(),
    dispatchPriority: "critical",
    prioritySource: "system",
    priorityReason: "Resident reported a vulnerable-person or critical circumstance.",
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: baseTime.toISOString(),
    availableAt: baseTime.toISOString(),
    claimedAt: baseTime.toISOString(),
    deliveredAt: null,
    confirmedAt: null,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
    dispatchBatchId: "batch-1",
    batchSequence: 1,
    dispatchOverrideRank: null,
    ...overrides,
  };
}

const driverNames = new Map<string, string>([
  ["driver-1", "Earl Ballentyne"],
  ["driver-2", "Andy Lavia"],
]);

describe("buildDispatchBatchPdfData", () => {
  it("includes the correct driver, batch id, and generation timestamp", () => {
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [makeRequest()],
      driverNames,
      generatedAt,
    );

    expect(data.batchId).toBe("batch-1");
    expect(data.driverName).toBe("Earl Ballentyne");
    expect(data.generatedAt).toBe(generatedAt.toISOString());
  });

  it("orders rows by batchSequence and maps core fields correctly", () => {
    const second = makeRequest({ id: "req-2", batchSequence: 2, village: "The Bottom" });
    const first = makeRequest({ id: "req-1", batchSequence: 1, village: "St Johns" });

    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [second, first],
      driverNames,
      generatedAt,
    );

    expect(data.rows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(data.rows[0].village).toBe("St Johns");
    expect(data.rows[0].customerName).toBe("Jane Resident");
    expect(data.rows[0].phone).toBe("+599-000-0001");
    expect(data.rows[0].gallons).toBe(1000);
    expect(data.rows[0].priority).toBe("critical");
  });

  it("computes age at generation time from requestedAt", () => {
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [makeRequest()],
      driverNames,
      generatedAt,
    );
    expect(data.rows[0].ageMinutesAtGeneration).toBe(150); // 2h30m
  });

  it("never includes water-situation privacy fields, email, or a raw request ID", () => {
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [makeRequest()],
      driverNames,
      generatedAt,
    );
    const row = data.rows[0] as unknown as Record<string, unknown>;
    expect(row.waterSituation).toBeUndefined();
    expect(row.criticalExplanation).toBeUndefined();
    expect(row.vulnerableCircumstances).toBeUndefined();
    expect(row.personsAffected).toBeUndefined();
    expect(row.email).toBeUndefined();
    expect(row.requestId).toBeUndefined();
  });

  it("flags a preferred driver that matches the batch driver as not an override", () => {
    const req = makeRequest({ preferredDriverId: "driver-1" });
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [req],
      driverNames,
      generatedAt,
    );
    expect(data.rows[0].preferredDriverName).toBe("Earl Ballentyne");
    expect(data.rows[0].preferredDriverIsBatchDriver).toBe(true);
  });

  it("flags a preferred driver that differs from the batch driver as an override", () => {
    const req = makeRequest({ preferredDriverId: "driver-2" });
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [req],
      driverNames,
      generatedAt,
    );
    expect(data.rows[0].preferredDriverName).toBe("Andy Lavia");
    expect(data.rows[0].preferredDriverIsBatchDriver).toBe(false);
  });

  it("preserves the requested quantity on each row", () => {
    const twoLoad = makeRequest({ id: "req-2", loads: 2, gallons: 2000 as StandardLoadGallons });
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [twoLoad],
      driverNames,
      generatedAt,
    );
    expect(data.rows[0].loads).toBe(2);
    expect(data.rows[0].gallons).toBe(2000);
  });

  it("preserves current status and delivered/confirmed timestamps for a reprint", () => {
    const delivered = makeRequest({
      status: "delivered",
      deliveredAt: generatedAt.toISOString(),
    });
    const data = buildDispatchBatchPdfData(
      "batch-1",
      "driver-1",
      "Earl Ballentyne",
      [delivered],
      driverNames,
      generatedAt,
    );
    expect(data.rows[0].status).toBe("delivered");
    expect(data.rows[0].deliveredAt).toBe(generatedAt.toISOString());
  });
});
