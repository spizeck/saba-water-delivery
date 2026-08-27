import { describe, expect, it } from "vitest";

import {
  checkActiveRequestValidity,
  type ReferencedRequestSnapshot,
} from "../activeRequestValidation";

const DRIVER = "driver-uid-1";

describe("checkActiveRequestValidity", () => {
  // -----------------------------------------------------------------------
  // Missing request (deleted)
  // -----------------------------------------------------------------------

  it("returns stale with reason request_missing when snapshot is null", () => {
    const result = checkActiveRequestValidity(DRIVER, null);
    expect(result).toEqual({ stale: true, reason: "request_missing" });
  });

  // -----------------------------------------------------------------------
  // Valid claimed request
  // -----------------------------------------------------------------------

  it("returns not stale for a claimed request assigned to the same driver", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "claimed",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: false });
  });

  // -----------------------------------------------------------------------
  // Reassigned away
  // -----------------------------------------------------------------------

  it("returns stale with reason reassigned when assigned to a different driver", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "claimed",
      assignedDriverId: "other-driver",
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "reassigned" });
  });

  it("returns stale with reason reassigned when assignedDriverId is null", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "claimed",
      assignedDriverId: null,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "reassigned" });
  });

  // -----------------------------------------------------------------------
  // Delivered
  // -----------------------------------------------------------------------

  it("returns stale with reason delivered for a delivered request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "delivered",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "delivered" });
  });

  // -----------------------------------------------------------------------
  // Cancelled
  // -----------------------------------------------------------------------

  it("returns stale with reason cancelled for a cancelled request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "cancelled",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "cancelled" });
  });

  // -----------------------------------------------------------------------
  // Confirmed
  // -----------------------------------------------------------------------

  it("returns stale with reason confirmed for a confirmed request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "confirmed",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "confirmed" });
  });

  // -----------------------------------------------------------------------
  // Disputed
  // -----------------------------------------------------------------------

  it("returns stale with reason disputed for a disputed request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "disputed",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "disputed" });
  });

  // -----------------------------------------------------------------------
  // Request returned to available / other pre-claim states
  // -----------------------------------------------------------------------

  it("returns stale with reason not_active for an available request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "available",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "not_active" });
  });

  it("returns stale with reason not_active for a requested-status request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "requested",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "not_active" });
  });

  it("returns stale with reason not_active for a preferred_driver_hold request", () => {
    const snapshot: ReferencedRequestSnapshot = {
      status: "preferred_driver_hold",
      assignedDriverId: DRIVER,
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "not_active" });
  });

  // -----------------------------------------------------------------------
  // Combined: reassigned + terminal status
  // -----------------------------------------------------------------------

  it("returns reassigned (not delivered) when delivered AND assigned elsewhere", () => {
    // Reassignment takes priority because the driver is not the owner.
    const snapshot: ReferencedRequestSnapshot = {
      status: "delivered",
      assignedDriverId: "other-driver",
    };
    const result = checkActiveRequestValidity(DRIVER, snapshot);
    expect(result).toEqual({ stale: true, reason: "reassigned" });
  });
});
