import { describe, expect, it } from "vitest";

import { continuityReportPdfFilename } from "@/lib/reports/continuityReportFilename";

describe("continuityReportPdfFilename", () => {
  it("uses the Saba-local calendar date, not the UTC date", () => {
    // 2026-08-22T00:00:00Z is midnight UTC, which is 8:00 PM Saba time
    // (UTC-4) on the PREVIOUS calendar day — exactly the nightly
    // generation moment. The filename must reflect the Saba date.
    expect(continuityReportPdfFilename("2026-08-22T00:00:00.000Z")).toBe(
      "saba-water-delivery-snapshot-2026-08-21.pdf",
    );
  });

  it("produces the expected filename format for a mid-day timestamp", () => {
    expect(continuityReportPdfFilename("2026-01-05T18:30:00.000Z")).toBe(
      "saba-water-delivery-snapshot-2026-01-05.pdf",
    );
  });

  it("never includes customer data — only a fixed prefix and a date", () => {
    const filename = continuityReportPdfFilename("2026-03-10T12:00:00.000Z");
    expect(filename).toMatch(/^saba-water-delivery-snapshot-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
