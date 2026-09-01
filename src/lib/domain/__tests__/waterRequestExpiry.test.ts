import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDbMock } = vi.hoisted(() => ({
  getAdminDbMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: getAdminDbMock }));

import { expirePreferredDriverHold } from "@/lib/domain/waterRequests";

describe("preferred-driver hold expiration", () => {
  beforeEach(() => {
    getAdminDbMock.mockReset();
  });

  it("treats a request deleted after the sweep query as already resolved", async () => {
    const requestRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
    };
    const transaction = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      update: vi.fn(),
      set: vi.fn(),
    };
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => requestRef) })),
      runTransaction: vi.fn(async (callback: (txn: typeof transaction) => Promise<void>) => {
        await callback(transaction);
      }),
    };
    getAdminDbMock.mockReturnValue(db);

    await expect(
      expirePreferredDriverHold({
        requestId: "deleted-request",
        now: new Date("2026-09-02T12:45:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.set).not.toHaveBeenCalled();
  });
});

