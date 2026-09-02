import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/deliveryConfirmationNotification", () => ({
  notifyDeliveryConfirmation: vi.fn(),
}));

import { toWaterRequest } from "../waterRequests";

function timestamp(date = "2026-09-02T12:00:00.000Z") {
  return { toDate: () => new Date(date) };
}

const base = {
  customerId: "resident-1",
  source: "resident",
  loads: 1,
  gallons: 1000,
  village: "Windwardside",
  deliveryDirections: "Blue gate",
  status: "available",
  requestedAt: timestamp(),
  createdAt: timestamp(),
  updatedAt: timestamp(),
};

describe("water request notes mapping", () => {
  it("accepts a missing note for historical requests", () => {
    expect(toWaterRequest("request-1", base).requestNotes).toBeNull();
  });

  it("trims a stored request note", () => {
    expect(
      toWaterRequest("request-1", { ...base, requestNotes: "  Call before arrival.  " })
        .requestNotes,
    ).toBe("Call before arrival.");
  });
});
