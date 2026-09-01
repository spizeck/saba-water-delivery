import { describe, expect, it } from "vitest";

import { appConfig } from "@/lib/domain/config";
import {
  decidePreferredDriverHold,
  isPreferredDriverHoldExpired,
} from "@/lib/domain/preferredDriverPolicy";

const createdAt = new Date("2026-09-01T12:45:00.000Z"); // 8:45 AM in Saba

describe("preferred-driver hold policy", () => {
  it("creates a configured 24-hour exclusive hold for a normal request", () => {
    const result = decidePreferredDriverHold({
      preferredDriverId: "driver-1",
      dispatchPriority: "normal",
      preferredDriverImmediatelyAvailable: false,
      now: createdAt,
      windowHours: appConfig.preferredDriverWindowHours,
    });

    expect(result).toEqual({
      willHold: true,
      status: "preferred_driver_hold",
      expiresAt: new Date("2026-09-02T12:45:00.000Z"),
      bypassedForPriority: false,
    });
  });

  it.each(["urgent", "critical"] as const)(
    "holds a %s request only when the preferred driver is immediately available",
    (dispatchPriority) => {
      const online = decidePreferredDriverHold({
        preferredDriverId: "driver-1",
        dispatchPriority,
        preferredDriverImmediatelyAvailable: true,
        now: createdAt,
        windowHours: appConfig.preferredDriverWindowHours,
      });
      const offline = decidePreferredDriverHold({
        preferredDriverId: "driver-1",
        dispatchPriority,
        preferredDriverImmediatelyAvailable: false,
        now: createdAt,
        windowHours: appConfig.preferredDriverWindowHours,
      });

      expect(online.status).toBe("preferred_driver_hold");
      expect(offline).toMatchObject({
        willHold: false,
        status: "available",
        expiresAt: null,
        bypassedForPriority: true,
      });
    },
  );

  it("sends a request without a preferred driver directly to the general queue", () => {
    const result = decidePreferredDriverHold({
      preferredDriverId: null,
      dispatchPriority: "normal",
      preferredDriverImmediatelyAvailable: false,
      now: createdAt,
      windowHours: appConfig.preferredDriverWindowHours,
    });

    expect(result).toEqual({
      willHold: false,
      status: "available",
      expiresAt: null,
      bypassedForPriority: false,
    });
  });

  it("keeps the hold exclusive before expiry and releases it at the exact boundary", () => {
    const expiresAt = new Date("2026-09-02T12:45:00.000Z");

    expect(isPreferredDriverHoldExpired(expiresAt, new Date("2026-09-02T12:44:59.999Z"))).toBe(false);
    expect(isPreferredDriverHoldExpired(expiresAt, new Date("2026-09-02T12:45:00.000Z"))).toBe(true);
  });

  it("uses elapsed time across Saba midnight rather than a calendar-day rollover", () => {
    // Created at 11:30 PM Saba time on Sep 1; it must remain held through
    // the next morning and release at 11:30 PM Saba time on Sep 2.
    const lateEveningSaba = new Date("2026-09-02T03:30:00.000Z");
    const decision = decidePreferredDriverHold({
      preferredDriverId: "driver-1",
      dispatchPriority: "normal",
      preferredDriverImmediatelyAvailable: false,
      now: lateEveningSaba,
      windowHours: appConfig.preferredDriverWindowHours,
    });

    expect(decision.expiresAt?.toISOString()).toBe("2026-09-03T03:30:00.000Z");
    expect(
      isPreferredDriverHoldExpired(decision.expiresAt, new Date("2026-09-02T12:00:00.000Z")),
    ).toBe(false);
    expect(
      isPreferredDriverHoldExpired(decision.expiresAt, new Date("2026-09-03T03:30:00.000Z")),
    ).toBe(true);
  });
});
