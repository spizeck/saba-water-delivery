import { describe, expect, it } from "vitest";

import { dispatchBatchPdfFilename } from "@/lib/reports/dispatchBatchPdfFilename";

describe("dispatchBatchPdfFilename", () => {
  it("uses the Saba-local calendar date, not the UTC date", () => {
    // 2026-08-22T00:00:00Z is midnight UTC, which is 8:00 PM Saba time
    // (UTC-4) on the PREVIOUS calendar day.
    expect(dispatchBatchPdfFilename("batch-abcdef1234", "Earl Ballentyne", "2026-08-22T00:00:00.000Z")).toBe(
      "saba-water-delivery-dispatch-sheet-earl-ballentyne-batch-ab-2026-08-21.pdf",
    );
  });

  it("slugifies the driver name (lowercase, non-alphanumeric collapsed to dashes)", () => {
    const filename = dispatchBatchPdfFilename("batch-1", "O'Brien, Jr.", "2026-01-05T18:30:00.000Z");
    expect(filename).toContain("o-brien-jr");
  });

  it("truncates the batch ID to a short identifier", () => {
    const filename = dispatchBatchPdfFilename("0123456789abcdef", "Earl", "2026-01-05T18:30:00.000Z");
    expect(filename).toContain("01234567");
    expect(filename).not.toContain("0123456789abcdef");
  });

  it("never includes customer data — only driver name, batch id, and date", () => {
    const filename = dispatchBatchPdfFilename("batch-1", "Earl Ballentyne", "2026-03-10T12:00:00.000Z");
    expect(filename).toMatch(
      /^saba-water-delivery-dispatch-sheet-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
  });
});
