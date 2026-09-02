import { describe, expect, it } from "vitest";

import { safeResidentReturnTo } from "../returnTo";

describe("safe resident return URL", () => {
  it("accepts a resident delivery-review deep link", () => {
    expect(
      safeResidentReturnTo("/resident?requestId=request-123#delivery-confirmation"),
    ).toBe("/resident?requestId=request-123#delivery-confirmation");
  });

  it("accepts the resident review route", () => {
    expect(safeResidentReturnTo("/resident/review/request-123")).toBe(
      "/resident/review/request-123",
    );
  });

  it("rejects external and non-resident redirects", () => {
    expect(safeResidentReturnTo("https://evil.example/resident")).toBeNull();
    expect(safeResidentReturnTo("//evil.example/resident")).toBeNull();
    expect(safeResidentReturnTo("/admin")).toBeNull();
  });

  it("rejects unsafe request IDs and extra parameters", () => {
    expect(safeResidentReturnTo("/resident?requestId=bad/value")).toBeNull();
    expect(safeResidentReturnTo("/resident?requestId=ok&next=/admin")).toBeNull();
  });
});
