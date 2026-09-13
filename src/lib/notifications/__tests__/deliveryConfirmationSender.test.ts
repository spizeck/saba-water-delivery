import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWaterRequestById: vi.fn(),
  getUserProfile: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain/waterRequests", () => ({
  getWaterRequestById: mocks.getWaterRequestById,
}));
vi.mock("@/lib/domain/users", () => ({
  getUserProfile: mocks.getUserProfile,
}));
vi.mock("@/lib/email/deliveryConfirmationEmail", () => ({
  sendDeliveryConfirmationEmail: mocks.sendEmail,
}));

import { sendDeliveryConfirmationFromOutbox } from "../deliveryConfirmationSender";
import type { OutboxRecord } from "../outbox";

/**
 * Sender eligibility + failure-classification tests (issue #53). Confirms the
 * send-time recompute preserves product behavior — including that a delivery
 * which has left the `delivered` state (confirmed/disputed/reopened) no longer
 * produces a stale confirmation email — without touching Resend.
 */

const record: OutboxRecord = {
  id: "delivery_confirmation_email__req-1",
  type: "delivery_confirmation_email",
  requestId: "req-1",
  customerId: "cust-1",
  providerIdempotencyKey: "delivery-confirmation-req-1",
  state: "processing",
  attemptCount: 0,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    status: "delivered",
    deliveredAt: "2026-01-01T12:00:00.000Z",
    customerId: "cust-1",
    loads: 1,
    gallons: 1000,
    village: "Windwardside",
    deliveryDirections: "Blue gate",
    customer: { displayName: "Jane" },
    ...overrides,
  };
}

const claimedProfile = {
  authStatus: "claimed",
  email: "jane@example.com",
  displayName: "Jane Resident",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserProfile.mockResolvedValue(claimedProfile);
});

describe("sendDeliveryConfirmationFromOutbox", () => {
  it("sends for a delivered request with a claimed resident, reusing the stored key", async () => {
    mocks.getWaterRequestById.mockResolvedValue(request());
    mocks.sendEmail.mockResolvedValue({ ok: true, resendId: "resend-9" });

    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toEqual({ status: "sent", providerMessageId: "resend-9" });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jane@example.com", requestId: "req-1" }),
      { idempotencyKey: "delivery-confirmation-req-1" },
    );
  });

  it("does NOT send once the request has left the delivered state (confirmed)", async () => {
    mocks.getWaterRequestById.mockResolvedValue(
      request({ status: "confirmed" }),
    );
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toEqual({
      status: "failed",
      category: "recipient_ineligible",
      reason: "request_not_awaiting_confirmation",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send for a disputed request", async () => {
    mocks.getWaterRequestById.mockResolvedValue(
      request({ status: "disputed" }),
    );
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome.status).toBe("failed");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("is terminal for an unregistered requestor (no authenticated link)", async () => {
    mocks.getWaterRequestById.mockResolvedValue(request({ customerId: null }));
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toMatchObject({
      status: "failed",
      category: "recipient_ineligible",
      reason: "unregistered_requestor",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("maps an unconfigured provider to configuration_disabled (terminal)", async () => {
    mocks.getWaterRequestById.mockResolvedValue(request());
    mocks.sendEmail.mockResolvedValue({ ok: false, notConfigured: true });
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toMatchObject({
      status: "failed",
      category: "configuration_disabled",
    });
  });

  it("classifies a provider validation error as permanent", async () => {
    mocks.getWaterRequestById.mockResolvedValue(request());
    mocks.sendEmail.mockResolvedValue({
      ok: false,
      errorName: "validation_error",
    });
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toMatchObject({ status: "failed", category: "permanent" });
  });

  it("is terminal permanent when the request no longer exists", async () => {
    mocks.getWaterRequestById.mockResolvedValue(null);
    const outcome = await sendDeliveryConfirmationFromOutbox(record);
    expect(outcome).toMatchObject({
      status: "failed",
      category: "permanent",
      reason: "request_not_found",
    });
  });
});
