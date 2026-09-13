import { describe, expect, it } from "vitest";

import { classifyDriverLock, deriveBatchStatus } from "../recovery-checks.mjs";
import {
  checkActiveRequestValidity,
  type ReferencedRequestSnapshot,
} from "@/lib/domain/activeRequestValidation";
import { computeDispatchBatchStatus } from "@/lib/domain/dispatchBatchSelection";
import type { WaterRequestStatus } from "@/lib/domain/types";

/**
 * The operator tooling (`scripts/lib/recovery-checks.mjs`) keeps small
 * standalone copies of two canonical domain rules so it has no build step and
 * no dependency on the app's TypeScript modules:
 *   - `classifyDriverLock` mirrors `checkActiveRequestValidity`;
 *   - `deriveBatchStatus` mirrors `computeDispatchBatchStatus`.
 * These parity tests fail if either copy drifts from its canonical source, so
 * the duplication can never diverge silently.
 */

const STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "confirmed",
  "cancelled",
  "disputed",
];

describe("classifyDriverLock parity with checkActiveRequestValidity", () => {
  it("agrees for a missing referenced request", () => {
    const canonical = checkActiveRequestValidity("driver-1", null);
    const copy = classifyDriverLock("driver-1", undefined);
    expect(copy).toBe(canonical.stale ? canonical.reason : null);
  });

  it("agrees across every status, for same-driver and reassigned cases", () => {
    for (const status of STATUSES) {
      for (const assignedDriverId of ["driver-1", "driver-2"]) {
        const snapshot: ReferencedRequestSnapshot = {
          status,
          assignedDriverId,
        };
        const canonical = checkActiveRequestValidity("driver-1", snapshot);
        const copy = classifyDriverLock("driver-1", {
          status,
          assignedDriverId,
        });
        expect(copy).toBe(canonical.stale ? canonical.reason : null);
      }
    }
  });
});

describe("deriveBatchStatus parity with computeDispatchBatchStatus", () => {
  it("agrees for representative member-status sets", () => {
    const cases: WaterRequestStatus[][] = [
      [],
      ["claimed"],
      ["delivered"],
      ["confirmed"],
      ["delivered", "confirmed"],
      ["confirmed", "claimed"],
      ["disputed", "delivered"],
    ];
    for (const members of cases) {
      expect(deriveBatchStatus(members)).toBe(
        computeDispatchBatchStatus(members),
      );
    }
  });
});
