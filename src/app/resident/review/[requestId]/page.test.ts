import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getWaterRequestById: vi.fn(),
  checkDeliveryConfirmationTimeout: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/domain/waterRequests", () => ({
  getWaterRequestById: mocks.getWaterRequestById,
  checkDeliveryConfirmationTimeout: mocks.checkDeliveryConfirmationTimeout,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ResidentDeliveryReviewPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWaterRequestById.mockResolvedValue({
    id: "request-123",
    customerId: "resident-1",
    status: "delivered",
  });
  mocks.checkDeliveryConfirmationTimeout.mockResolvedValue({
    id: "request-123",
    customerId: "resident-1",
    status: "delivered",
  });
});

describe("resident delivery review route", () => {
  it("preserves an authenticated resident session and loads the exact request", async () => {
    mocks.getSessionUser.mockResolvedValue({
      uid: "resident-1",
      profile: { roles: ["resident"] },
    });
    await expect(
      ResidentDeliveryReviewPage({ params: Promise.resolve({ requestId: "request-123" }) }),
    ).resolves.toBeTruthy();
    expect(mocks.getWaterRequestById).toHaveBeenCalledWith("request-123");
    expect(mocks.checkDeliveryConfirmationTimeout).toHaveBeenCalledWith("request-123");
  });

  it("sends an unauthenticated resident through login with a safe return URL", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    await expect(
      ResidentDeliveryReviewPage({ params: Promise.resolve({ requestId: "request-123" }) }),
    ).rejects.toThrow("REDIRECT:/login?portal=resident&returnTo=");
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?portal=resident&returnTo=${encodeURIComponent(
        "/resident/review/request-123",
      )}`,
    );
  });
});
