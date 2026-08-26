import { describe, expect, it } from "vitest";

import {
  buildAccountSetupEmailPayload,
  getAccountSetupEmailConfig,
} from "./accountSetupEmailContent";

describe("getAccountSetupEmailConfig", () => {
  const originalEnv = process.env;

  it("returns null when required env vars are missing", () => {
    process.env = { ...originalEnv, RESEND_API_KEY: "", ACCOUNT_SETUP_EMAIL_FROM: "" };
    expect(getAccountSetupEmailConfig()).toBeNull();
  });

  it("returns config when present", () => {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "re_key",
      ACCOUNT_SETUP_EMAIL_FROM: "water@saba.example",
    };
    expect(getAccountSetupEmailConfig()).toEqual({
      apiKey: "re_key",
      from: "water@saba.example",
    });
  });

  it("falls back to continuity report sender", () => {
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "re_key",
      ACCOUNT_SETUP_EMAIL_FROM: "",
      CONTINUITY_REPORT_EMAIL_FROM: "continuity@saba.example",
    };
    expect(getAccountSetupEmailConfig()).toEqual({
      apiKey: "re_key",
      from: "continuity@saba.example",
    });
  });
});

describe("buildAccountSetupEmailPayload", () => {
  const config = { apiKey: "re_key", from: "water@saba.example" };

  it("includes setup link and branded text", () => {
    const payload = buildAccountSetupEmailPayload(
      {
        to: "bruce@example.com",
        displayName: "Bruce Zagers",
        setupLink: "https://example.com/auth?oobCode=abc",
        appUrl: "https://saba-water-delivery.example.com",
      },
      config,
    );

    expect(payload.from).toBe("water@saba.example");
    expect(payload.to).toBe("bruce@example.com");
    expect(payload.subject).toContain("Saba Water Delivery");
    expect(payload.text).toContain("https://example.com/auth?oobCode=abc");
    expect(payload.html).toContain("Bruce Zagers");
    expect(payload.text).toContain("choose your own password");
    expect(payload.text).not.toContain("temporary password");
  });

  it("handles missing display name gracefully", () => {
    const payload = buildAccountSetupEmailPayload(
      {
        to: "bruce@example.com",
        displayName: "",
        setupLink: "https://example.com/auth?oobCode=abc",
        appUrl: "https://saba-water-delivery.example.com",
      },
      config,
    );

    expect(payload.text).toContain("Hello,");
  });
});
