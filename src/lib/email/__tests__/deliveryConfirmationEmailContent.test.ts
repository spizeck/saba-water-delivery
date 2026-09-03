import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDeliveryConfirmationEmailPayload,
  buildDeliveryConfirmationReviewUrl,
  getDeliveryConfirmationEmailConfig,
} from "../deliveryConfirmationEmailContent";

const input = {
  to: "resident@example.com",
  displayName: "Jane Resident",
  requestId: "request-123",
  loads: 2 as const,
  gallons: 2000 as const,
  village: "Windwardside",
  deliveryDirections: "Blue gate",
  deliveredAt: "2026-09-02T18:30:00.000Z",
};

afterEach(() => vi.unstubAllEnvs());

describe("delivery confirmation email content", () => {
  it("builds the government-service email with request information and review URL", () => {
    const payload = buildDeliveryConfirmationEmailPayload(input, {
      apiKey: "secret",
      from: "Water Office <water@example.com>",
      appUrl: "https://saba-water-delivery.vercel.app",
    });

    expect(payload.subject).toBe("Please confirm your water delivery");
    expect(payload.text).toContain("Jane Resident");
    expect(payload.text).toContain("2 loads (2,000 gallons)");
    expect(payload.text).toContain("Windwardside — Blue gate");
    expect(payload.text).toContain("within 24 hours");
    expect(payload.text).toContain("confirmed automatically");
    expect(payload.text).toContain("request-123");
    expect(payload.html).toContain("Review Delivery");
  });

  it("creates a direct authenticated delivery-review URL", () => {
    const url = buildDeliveryConfirmationReviewUrl("https://example.test", "request-123");
    expect(url).toBe("https://example.test/resident/review/request-123");
  });

  it("uses the existing Resend configuration", () => {
    vi.stubEnv("RESEND_API_KEY", "key");
    vi.stubEnv("CONTINUITY_REPORT_EMAIL_FROM", "water@example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test/");
    expect(getDeliveryConfirmationEmailConfig()).toEqual({
      apiKey: "key",
      from: "water@example.com",
      appUrl: "https://example.test",
    });
  });
});
