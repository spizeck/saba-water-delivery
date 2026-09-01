import { describe, expect, it } from "vitest";

import { processInBatches } from "@/lib/utils/processInBatches";

describe("processInBatches", () => {
  it("processes every item without exceeding the configured concurrency", async () => {
    const items = Array.from({ length: 63 }, (_, index) => index);
    const processed: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    await processInBatches(items, 25, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      processed.push(item);
      inFlight -= 1;
    });

    expect(processed).toEqual(items);
    expect(maxInFlight).toBe(25);
    expect(inFlight).toBe(0);
  });

  it("rejects an invalid batch size", async () => {
    await expect(processInBatches([1], 0, async () => undefined)).rejects.toThrow(
      "INVALID_BATCH_SIZE",
    );
  });
});

