import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WaterRequest } from "@/lib/domain/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  getUserProfile: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (name: string) =>
      name === "deliveryConfirmationEmailClaims"
        ? { doc: () => ({ create: mocks.create, update: mocks.update }) }
        : {
            doc: () => ({
              collection: () => ({ doc: () => ({ set: mocks.set }) }),
            }),
          },
  }),
}));
vi.mock("@/lib/domain/users", () => ({ getUserProfile: mocks.getUserProfile }));
vi.mock("../deliveryConfirmationEmail", () => ({
  sendDeliveryConfirmationEmail: mocks.send,
}));

import { notifyDeliveryConfirmation } from "../deliveryConfirmationNotification";

const request = {
  id: "request-123",
  customerId: "resident-1",
  customer: { displayName: "Jane", phone: null, email: "old@example.com", isRegistered: true },
  loads: 2,
  gallons: 2000,
  village: "Windwardside",
  deliveryDirections: "Blue gate",
  deliveredAt: "2026-09-02T18:30:00.000Z",
} as WaterRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  mocks.set.mockResolvedValue(undefined);
  mocks.getUserProfile.mockResolvedValue({
    displayName: "Jane Resident",
    email: "resident@example.com",
    authStatus: "claimed",
  });
  mocks.send.mockResolvedValue({ ok: true, resendId: "email-1" });
});

describe("delivery confirmation notification", () => {
  it("sends registered residents the delivered request information", async () => {
    await notifyDeliveryConfirmation(request);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "resident@example.com",
        requestId: "request-123",
        loads: 2,
        gallons: 2000,
        village: "Windwardside",
        deliveryDirections: "Blue gate",
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", resendId: "email-1" }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "delivery_confirmation_email",
        metadata: expect.objectContaining({ status: "sent" }),
      }),
    );
  });

  it("does not send twice when the deterministic audit claim already exists", async () => {
    mocks.create.mockRejectedValueOnce(new Error("ALREADY_EXISTS"));
    await notifyDeliveryConfirmation(request);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records failure without throwing", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, error: "Resend unavailable" });
    await expect(notifyDeliveryConfirmation(request)).resolves.toBeUndefined();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "Resend unavailable" }),
    );
  });

  it("safely skips a registered resident without an email", async () => {
    mocks.getUserProfile.mockResolvedValueOnce({ displayName: "Jane", email: null, authStatus: "claimed" });
    await notifyDeliveryConfirmation(request);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped" }),
    );
  });

  it("does not email an unregistered requestor", async () => {
    await notifyDeliveryConfirmation({ ...request, customerId: null });
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
        error: "Unregistered requestor has no authenticated confirmation path.",
      }),
    );
  });
});
