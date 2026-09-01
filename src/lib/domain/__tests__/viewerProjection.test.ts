import { describe, expect, it } from "vitest";

import type { DriverRegistryEntry, WaterRequest } from "../types";
import { toViewerDriverRow, toViewerRequestRow } from "../viewerProjection";

describe("viewer projections", () => {
  it("projects request oversight fields without customer PII or internal details", () => {
    const request = {
      id: "request-a",
      status: "claimed",
      dispatchPriority: "urgent",
      loads: 2,
      village: "The Bottom",
      source: "dispatcher",
      requestedAt: "2026-09-01T12:00:00.000Z",
      assignedDriverId: "private-driver-uid",
      customerId: "private-customer-uid",
      customer: {
        displayName: "Private Resident",
        phone: "private-phone",
        email: "private@example.com",
        isRegistered: true,
      },
      deliveryDirections: "Private directions",
      priorityReason: "Private medical reason",
      waterSituation: { vulnerableCircumstances: ["medical_need"] },
    } as WaterRequest;

    const row = toViewerRequestRow(request);

    expect(row).toEqual({
      id: "request-a",
      status: "claimed",
      dispatchPriority: "urgent",
      loads: 2,
      village: "The Bottom",
      source: "dispatcher",
      requestedAt: "2026-09-01T12:00:00.000Z",
      hasAssignedDriver: true,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("Private Resident");
    expect(serialized).not.toContain("private-phone");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Private directions");
    expect(serialized).not.toContain("Private medical reason");
    expect(serialized).not.toContain("private-driver-uid");
    expect(serialized).not.toContain("private-customer-uid");
  });

  it("projects driver oversight fields without phone, account ID, or lock details", () => {
    const driver = {
      id: "registry-a",
      displayName: "Demo Driver",
      eligibilityStatus: "eligible",
      availabilityStatus: "online",
      linkedUserId: "private-linked-uid",
      phone: "private-phone",
      activeRequestId: "private-request-id",
    } as DriverRegistryEntry;

    const row = toViewerDriverRow(driver);

    expect(row).toEqual({
      id: "registry-a",
      displayName: "Demo Driver",
      eligibilityStatus: "eligible",
      availabilityStatus: "online",
      accountLinked: true,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("private-phone");
    expect(serialized).not.toContain("private-linked-uid");
    expect(serialized).not.toContain("private-request-id");
  });
});
