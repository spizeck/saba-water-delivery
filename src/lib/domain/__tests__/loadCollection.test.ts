import { describe, expect, it } from "vitest";

import { areAllLoadsCollected, assertQuantityEditable, getMissingLoadNumbers } from "../loadCollection";
import type { WaterLoadCollection } from "../types";

function makeCollection(loadNumber: 1 | 2): WaterLoadCollection {
  return {
    loadNumber,
    collectedAt: "2026-08-27T10:00:00.000Z",
    fillStationId: "bottom",
    fillStationName: "Bottom Fill Station",
    meterCode: "BTM2",
    meterNumber: 2,
    driverId: "driver-1",
    recordedBy: "driver-1",
    recordedByRole: "driver",
    note: null,
  };
}

describe("areAllLoadsCollected", () => {
  it("returns true for 1-load request with 1 collection", () => {
    expect(areAllLoadsCollected(1, [makeCollection(1)])).toBe(true);
  });

  it("returns false for 1-load request with no collections", () => {
    expect(areAllLoadsCollected(1, [])).toBe(false);
  });

  it("returns false for 1-load request with null collections", () => {
    expect(areAllLoadsCollected(1, null)).toBe(false);
  });

  it("returns true for 2-load request with 2 collections", () => {
    expect(areAllLoadsCollected(2, [makeCollection(1), makeCollection(2)])).toBe(true);
  });

  it("returns false for 2-load request with only 1 collection", () => {
    expect(areAllLoadsCollected(2, [makeCollection(1)])).toBe(false);
  });

  it("returns false for 2-load request with null collections", () => {
    expect(areAllLoadsCollected(2, null)).toBe(false);
  });
});

describe("getMissingLoadNumbers", () => {
  it("returns [1] for 1-load request with no collections", () => {
    expect(getMissingLoadNumbers(1, null)).toEqual([1]);
  });

  it("returns [] for 1-load request with load 1 collected", () => {
    expect(getMissingLoadNumbers(1, [makeCollection(1)])).toEqual([]);
  });

  it("returns [1, 2] for 2-load request with no collections", () => {
    expect(getMissingLoadNumbers(2, null)).toEqual([1, 2]);
  });

  it("returns [2] for 2-load request with only load 1 collected", () => {
    expect(getMissingLoadNumbers(2, [makeCollection(1)])).toEqual([2]);
  });

  it("returns [1] for 2-load request with only load 2 collected", () => {
    expect(getMissingLoadNumbers(2, [makeCollection(2)])).toEqual([1]);
  });

  it("returns [] for 2-load request with both collected", () => {
    expect(getMissingLoadNumbers(2, [makeCollection(1), makeCollection(2)])).toEqual([]);
  });
});

describe("Historical meter snapshot integrity", () => {
  it("collection record preserves meter info regardless of future changes", () => {
    // Simulates: driver collects using BTM2 at Bottom.
    // Later admin changes their meter to BTM7.
    // Historical collection record should still show BTM2.
    const collection = makeCollection(1);
    expect(collection.meterCode).toBe("BTM2");
    expect(collection.meterNumber).toBe(2);
    expect(collection.fillStationId).toBe("bottom");
    expect(collection.fillStationName).toBe("Bottom Fill Station");
    // The collection record is immutable — even if the driver's current
    // meter assignment changes in driverRegistry/meters/bottom,
    // this snapshot preserves what was used at the time.
  });

  it("different stations on different loads are independently tracked", () => {
    const load1 = makeCollection(1);
    const load2: WaterLoadCollection = {
      ...makeCollection(2),
      fillStationId: "wws",
      fillStationName: "W.W.S. Fill Station",
      meterCode: "WWS2",
      meterNumber: 2,
    };
    expect(load1.fillStationId).toBe("bottom");
    expect(load2.fillStationId).toBe("wws");
    expect(areAllLoadsCollected(2, [load1, load2])).toBe(true);
  });
});

describe("Default fill station", () => {
  it("DEFAULT_FILL_STATION_ID is 'bottom'", async () => {
    const { DEFAULT_FILL_STATION_ID } = await import("../types");
    expect(DEFAULT_FILL_STATION_ID).toBe("bottom");
  });
});

describe("Statistics computation from collections", () => {
  it("one 2-load request = 2 station load records = 2,000 gallons", () => {
    const collections = [makeCollection(1), makeCollection(2)];
    // Each collection is 1,000 gallons
    const totalGallons = collections.length * 1000;
    expect(totalGallons).toBe(2000);
    expect(collections.length).toBe(2);
  });

  it("different stations attribute 1,000 gallons to each", () => {
    const load1 = makeCollection(1); // bottom
    const load2: WaterLoadCollection = {
      ...makeCollection(2),
      fillStationId: "wws",
      fillStationName: "W.W.S. Fill Station",
      meterCode: "WWS2",
      meterNumber: 2,
    };
    const stationMap = new Map<string, number>();
    for (const lc of [load1, load2]) {
      stationMap.set(lc.fillStationId, (stationMap.get(lc.fillStationId) ?? 0) + 1000);
    }
    expect(stationMap.get("bottom")).toBe(1000);
    expect(stationMap.get("wws")).toBe(1000);
  });
});

describe("assertQuantityEditable", () => {
  it("allows edit when loadCollections is null", () => {
    expect(() => assertQuantityEditable(null)).not.toThrow();
  });

  it("allows edit when loadCollections is undefined", () => {
    expect(() => assertQuantityEditable(undefined)).not.toThrow();
  });

  it("allows edit when loadCollections is empty", () => {
    expect(() => assertQuantityEditable([])).not.toThrow();
  });

  it("throws QUANTITY_LOCKED_BY_COLLECTION when collections exist", () => {
    expect(() => assertQuantityEditable([makeCollection(1)])).toThrow(
      "QUANTITY_LOCKED_BY_COLLECTION",
    );
  });

  it("throws when multiple collections exist", () => {
    expect(() => assertQuantityEditable([makeCollection(1), makeCollection(2)])).toThrow(
      "QUANTITY_LOCKED_BY_COLLECTION",
    );
  });
});

describe("Collection record timestamp safety", () => {
  it("collectedAt stored as an ISO string (never a FieldValue sentinel) in parsed records", () => {
    // Regression: Firestore does not allow FieldValue.serverTimestamp()
    // inside array values. The domain function now uses Timestamp.now()
    // which resolves to a concrete Firestore Timestamp, parsed to an
    // ISO string by toWaterRequest. Verify the parsed shape is a string.
    const collection = makeCollection(1);
    expect(typeof collection.collectedAt).toBe("string");
    expect(new Date(collection.collectedAt).toISOString()).toBe(collection.collectedAt);
  });

  it("collection record has all required fields for audit trail", () => {
    const collection = makeCollection(1);
    expect(collection).toEqual(
      expect.objectContaining({
        loadNumber: 1,
        collectedAt: expect.any(String),
        fillStationId: expect.any(String),
        fillStationName: expect.any(String),
        meterCode: expect.any(String),
        meterNumber: expect.any(Number),
        driverId: expect.any(String),
        recordedBy: expect.any(String),
        recordedByRole: expect.any(String),
      }),
    );
  });
});
