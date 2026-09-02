import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { sendDeliveryConfirmationEmail } from "../deliveryConfirmationEmail";

const input = {
  to: "resident@example.com",
  displayName: "Jane",
  requestId: "request-123",
  loads: 1 as const,
  gallons: 1000 as const,
  village: "Windwardside",
  deliveryDirections: "Blue gate",
  deliveredAt: "2026-09-02T18:30:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "key");
  vi.stubEnv("DELIVERY_CONFIRMATION_EMAIL_FROM", "water@example.com");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
});

describe("delivery confirmation email sender", () => {
  it("passes a deterministic idempotency key to Resend", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await expect(sendDeliveryConfirmationEmail(input)).resolves.toEqual({
      ok: true,
      resendId: "email-1",
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "resident@example.com" }),
      { idempotencyKey: "delivery-confirmation-request-123" },
    );
  });

  it("returns a failure instead of throwing", async () => {
    mocks.send.mockRejectedValue(new Error("Resend unavailable"));
    await expect(sendDeliveryConfirmationEmail(input)).resolves.toEqual({
      ok: false,
      error: "Resend unavailable",
    });
  });
});
