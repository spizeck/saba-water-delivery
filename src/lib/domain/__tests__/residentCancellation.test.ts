import { describe, expect, it } from "vitest";

import {
  isResidentCancellableRequest,
  RESIDENT_CANCELLABLE_STATUSES,
} from "../residentCancellation";
import type { WaterRequestStatus } from "../types";

/**
 * Pure eligibility rules for resident self-service cancellation
 * (issue #23). The same helper runs inside the server transaction and
 * drives the resident UI's Cancel button, so these cases pin down
 * exactly which stored states are still genuinely pre-dispatch.
 */
describe("isResidentCancellableRequest", () => {
  const clean = { assignedDriverId: null, dispatchBatchId: null };

  it.each(RESIDENT_CANCELLABLE_STATUSES)(
    "allows the pre-dispatch status %s",
    (status) => {
      expect(isResidentCancellableRequest({ ...clean, status })).toBe(true);
    },
  );

  it("only lists requested / preferred_driver_hold / available", () => {
    expect(RESIDENT_CANCELLABLE_STATUSES).toEqual([
      "requested",
      "preferred_driver_hold",
      "available",
    ]);
  });

  it.each([
    "claimed",
    "delivered",
    "confirmed",
    "disputed",
    "cancelled",
  ] satisfies WaterRequestStatus[])(
    "rejects %s — already inside or past physical delivery operations",
    (status) => {
      expect(isResidentCancellableRequest({ ...clean, status })).toBe(false);
    },
  );

  it("rejects a superficially-eligible status that has an assigned driver", () => {
    expect(
      isResidentCancellableRequest({
        ...clean,
        status: "available",
        assignedDriverId: "driver-uid-1",
      }),
    ).toBe(false);
  });

  it("rejects a superficially-eligible status committed to a delivery run", () => {
    expect(
      isResidentCancellableRequest({
        ...clean,
        status: "preferred_driver_hold",
        dispatchBatchId: "batch-1",
      }),
    ).toBe(false);
  });

  it("treats a missing dispatchBatchId field as no run membership", () => {
    expect(
      isResidentCancellableRequest({
        status: "available",
        assignedDriverId: null,
      }),
    ).toBe(true);
  });
});
