import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the `recordCustomerDispute` server action (issue #50):
 * the staff-role authorization boundary, input validation, and domain
 * error → user-facing message mapping. The domain function's eligibility
 * and race-safety rules are covered by
 * `src/lib/domain/__tests__/staffRecordedDispute.emulator.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  recordCustomerDisputeByStaff: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/logging", () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
  serializeError: (e: unknown) => e,
}));
vi.mock("@/lib/domain/waterRequests", () => ({
  cancelWaterRequest: vi.fn(),
  changeRequestPriority: vi.fn(),
  confirmDeliveryByStaff: vi.fn(),
  createWaterRequest: vi.fn(),
  dispatcherAssign: vi.fn(),
  dispatcherReassign: vi.fn(),
  editWaterRequest: vi.fn(),
  escalateDispatchRequest: vi.fn(),
  findActiveRequestsByPhone: vi.fn(),
  getActiveRequestForCustomer: vi.fn(),
  getFrequentRequestCountForCustomer: vi.fn(),
  markWaterDeliveredByStaff: vi.fn(),
  recordCustomerDisputeByStaff: mocks.recordCustomerDisputeByStaff,
  recordWaterCollection: vi.fn(),
  resolveDisputeCompleted: vi.fn(),
  resolveDisputeReopened: vi.fn(),
  returnAssignedRequestToQueue: vi.fn(),
}));
vi.mock("@/lib/domain/continuityReport", () => ({
  generateContinuityReportData: vi.fn(),
}));
vi.mock("@/lib/domain/dispatchBatches", () => ({
  closeDeliveryRun: vi.fn(),
  createDispatchBatch: vi.fn(),
}));
vi.mock("@/lib/domain/dispatchBatchSelection", () => ({
  MAX_BATCH_SIZE: 10,
}));
vi.mock("@/lib/domain/driverRegistry", () => ({
  getDriverByLinkedUserId: vi.fn(),
  reconcileActiveRequest: vi.fn(),
  restrictDriver: vi.fn(),
  restoreDriver: vi.fn(),
}));
vi.mock("@/lib/domain/identity", () => ({
  createAccountInvitation: vi.fn(),
  getEmailAccountStatus: vi.fn(),
}));
vi.mock("@/lib/domain/quantity", () => ({ parseRequestedLoads: vi.fn() }));
vi.mock("@/lib/domain/priority", () => ({
  isValidDispatchPriority: vi.fn(),
}));
vi.mock("@/lib/domain/waterSituationForm", () => ({
  parseWaterSituationFromFormData: vi.fn(),
}));
vi.mock("@/lib/email/continuityReportEmail", () => ({
  sendContinuityReportEmail: vi.fn(),
}));
vi.mock("@/lib/reports/continuityReportPdf", () => ({
  renderContinuityReportPdf: vi.fn(),
}));

import { recordCustomerDispute } from "../actions";

const IDLE = { status: "idle" as const };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function staffSession(roles: string[]) {
  return { uid: "staff-uid-1", profile: { roles } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue(staffSession(["dispatcher"]));
  mocks.recordCustomerDisputeByStaff.mockResolvedValue({ id: "r1" });
});

describe("recordCustomerDispute — authorization boundary", () => {
  it("gates the action to dispatcher/admin staff roles server-side", async () => {
    await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "Customer reported a problem." }),
    );
    expect(mocks.requireRole).toHaveBeenCalledWith(["dispatcher", "admin"]);
  });

  it("never reaches the domain function when the role check fails", async () => {
    mocks.requireRole.mockRejectedValue(new Error("REDIRECT:/access-denied"));
    await expect(
      recordCustomerDispute(
        IDLE,
        makeFormData({ requestId: "r1", reason: "x" }),
      ),
    ).rejects.toThrow("REDIRECT:/access-denied");
    expect(mocks.recordCustomerDisputeByStaff).not.toHaveBeenCalled();
  });

  it("records the actor's real role — admin stays admin", async () => {
    mocks.requireRole.mockResolvedValue(staffSession(["admin"]));
    await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "Customer reported a problem." }),
    );
    expect(mocks.recordCustomerDisputeByStaff).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "staff-uid-1", actorRole: "admin" }),
    );
  });

  it("records dispatcher when the actor holds the dispatcher role", async () => {
    mocks.requireRole.mockResolvedValue(staffSession(["dispatcher", "admin"]));
    await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "Customer reported a problem." }),
    );
    expect(mocks.recordCustomerDisputeByStaff).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "dispatcher" }),
    );
  });
});

describe("recordCustomerDispute — input validation", () => {
  it("rejects a missing request id without calling the domain", async () => {
    const result = await recordCustomerDispute(
      IDLE,
      makeFormData({ reason: "x" }),
    );
    expect(result.status).toBe("error");
    expect(mocks.recordCustomerDisputeByStaff).not.toHaveBeenCalled();
  });

  it.each(["", "   "])(
    "rejects an empty/whitespace reason (%j) without calling the domain",
    async (reason) => {
      const result = await recordCustomerDispute(
        IDLE,
        makeFormData({ requestId: "r1", reason }),
      );
      expect(result).toMatchObject({ status: "error" });
      expect(mocks.recordCustomerDisputeByStaff).not.toHaveBeenCalled();
    },
  );

  it("trims the reason before handing it to the domain", async () => {
    await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "  Customer says no water.  " }),
    );
    expect(mocks.recordCustomerDisputeByStaff).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Customer says no water." }),
    );
  });
});

describe("recordCustomerDispute — domain error mapping", () => {
  it.each([
    ["REQUEST_NOT_FOUND", "Request not found."],
    ["REQUEST_HAS_REGISTERED_CUSTOMER", "registered customer"],
    ["INVALID_STATUS_FOR_DISPUTE", "status changed"],
    ["DISPUTE_REASON_REQUIRED", "Describe what the customer reported."],
    ["DISPUTE_REASON_TOO_LONG", "1,000 characters"],
  ])("maps %s to a friendly error", async (code, expected) => {
    mocks.recordCustomerDisputeByStaff.mockRejectedValue(new Error(code));
    const result = await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "Customer reported a problem." }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain(expected);
  });

  it("rethrows unexpected domain errors", async () => {
    mocks.recordCustomerDisputeByStaff.mockRejectedValue(
      new Error("FIRESTORE_UNAVAILABLE"),
    );
    await expect(
      recordCustomerDispute(
        IDLE,
        makeFormData({ requestId: "r1", reason: "x" }),
      ),
    ).rejects.toThrow("FIRESTORE_UNAVAILABLE");
  });
});

describe("recordCustomerDispute — success", () => {
  it("revalidates the dispatcher views and returns a success state", async () => {
    const result = await recordCustomerDispute(
      IDLE,
      makeFormData({ requestId: "r1", reason: "Customer reported a problem." }),
    );
    expect(result.status).toBe("success");
    expect(result.message).toContain("dispute");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dispatcher");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dispatcher/r1");
  });
});
