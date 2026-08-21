import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContinuityReportData } from "@/lib/domain/continuityReport";
import {
  buildContinuityReportEmailPayload,
  getContinuityReportEmailConfig,
  parseRecipientList,
} from "@/lib/email/continuityReportEmailContent";

const ORIGINAL_ENV = { ...process.env };

const sampleData: ContinuityReportData = {
  generatedAt: "2026-08-22T00:00:00.000Z", // midnight UTC == 8:00 PM Saba (UTC-4) the prior day
  unassigned: [],
  assigned: [],
};

function setEmailEnv(overrides: Partial<Record<string, string>> = {}) {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.CONTINUITY_REPORT_EMAIL_FROM = "ops@saba-water-delivery.gov";
  process.env.CONTINUITY_REPORT_EMAIL_TO = "dispatch@example.com";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("parseRecipientList", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseRecipientList("a@example.com,b@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("trims surrounding whitespace around each address", () => {
    expect(parseRecipientList(" a@example.com , b@example.com ")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("drops empty entries from trailing/duplicate commas", () => {
    expect(parseRecipientList("a@example.com,,b@example.com,")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("returns an empty array for a blank string", () => {
    expect(parseRecipientList("   ")).toEqual([]);
  });
});

describe("getContinuityReportEmailConfig", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns null when RESEND_API_KEY is missing", () => {
    setEmailEnv({ RESEND_API_KEY: undefined });
    expect(getContinuityReportEmailConfig()).toBeNull();
  });

  it("returns null when CONTINUITY_REPORT_EMAIL_FROM is missing", () => {
    setEmailEnv({ CONTINUITY_REPORT_EMAIL_FROM: undefined });
    expect(getContinuityReportEmailConfig()).toBeNull();
  });

  it("returns null when CONTINUITY_REPORT_EMAIL_TO is missing", () => {
    setEmailEnv({ CONTINUITY_REPORT_EMAIL_TO: undefined });
    expect(getContinuityReportEmailConfig()).toBeNull();
  });

  it("returns null when CONTINUITY_REPORT_EMAIL_TO parses to no addresses", () => {
    setEmailEnv({ CONTINUITY_REPORT_EMAIL_TO: "   ,  ," });
    expect(getContinuityReportEmailConfig()).toBeNull();
  });

  it("returns a parsed config when fully configured", () => {
    setEmailEnv({ CONTINUITY_REPORT_EMAIL_TO: "a@example.com, b@example.com" });
    expect(getContinuityReportEmailConfig()).toEqual({
      apiKey: "re_test_key",
      from: "ops@saba-water-delivery.gov",
      to: ["a@example.com", "b@example.com"],
    });
  });
});

describe("buildContinuityReportEmailPayload", () => {
  it("builds the expected From/To/Subject/attachment payload", () => {
    const pdfBuffer = Buffer.from("pdf-bytes");
    const payload = buildContinuityReportEmailPayload(pdfBuffer, sampleData, {
      apiKey: "re_test_key",
      from: "ops@saba-water-delivery.gov",
      to: ["dispatch@example.com", "supervisor@example.com"],
    });

    expect(payload.from).toBe("ops@saba-water-delivery.gov");
    expect(payload.to).toEqual(["dispatch@example.com", "supervisor@example.com"]);
    expect(payload.subject).toBe(
      "Saba Water Delivery - Outstanding Delivery Snapshot (2026-08-21)",
    );
    expect(payload.text).toContain("8:00 PM Saba time");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe(
      "saba-water-delivery-snapshot-2026-08-21.pdf",
    );
    expect(payload.attachments[0].content).toBe(pdfBuffer);

    // No unexpected/sensitive fields (e.g. the API key must never end
    // up in the email payload sent to Resend).
    expect(payload).not.toHaveProperty("apiKey");
    expect(Object.keys(payload).sort()).toEqual(
      ["attachments", "from", "subject", "text", "to"].sort(),
    );
  });
});
