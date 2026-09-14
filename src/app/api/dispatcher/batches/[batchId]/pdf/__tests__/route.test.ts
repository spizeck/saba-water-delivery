import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for GET /api/dispatcher/batches/[batchId]/pdf — the staff-only
 * delivery-run sheet. Invariants covered: the staff authorization boundary
 * runs before any data access, a missing batch is a clean 404 (no PDF, no
 * audit write), and every successful download records `recordBatchGenerated`
 * so a reprint is itself an audited event.
 */

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getDispatchBatch: vi.fn(),
  recordBatchGenerated: vi.fn(),
  buildDispatchBatchPdfData: vi.fn(),
  getAllDriverRegistryEntries: vi.fn(),
  getRequestsForDispatchBatch: vi.fn(),
  renderDispatchBatchPdf: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/domain/dispatchBatches", () => ({
  getDispatchBatch: mocks.getDispatchBatch,
  recordBatchGenerated: mocks.recordBatchGenerated,
}));
vi.mock("@/lib/domain/dispatchBatchPdfData", () => ({
  buildDispatchBatchPdfData: mocks.buildDispatchBatchPdfData,
}));
vi.mock("@/lib/domain/driverRegistry", () => ({
  getAllDriverRegistryEntries: mocks.getAllDriverRegistryEntries,
}));
vi.mock("@/lib/domain/waterRequests", () => ({
  getRequestsForDispatchBatch: mocks.getRequestsForDispatchBatch,
}));
vi.mock("@/lib/reports/dispatchBatchPdf", () => ({
  renderDispatchBatchPdf: mocks.renderDispatchBatchPdf,
  dispatchBatchPdfFilename: () => "run-sheet.pdf",
}));

import { GET } from "@/app/api/dispatcher/batches/[batchId]/pdf/route";

function makeRequest() {
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/dispatcher/batches/b1/pdf",
  );
}

const PARAMS = { params: Promise.resolve({ batchId: "b1" }) };

/** Error shape `unstable_rethrow` recognizes as a real Next.js redirect. */
function redirectError(url: string): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;replace;${url};307;`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dispatcher/batches/[batchId]/pdf", () => {
  it("gates all data access behind the staff role check", async () => {
    mocks.requireRole.mockRejectedValue(redirectError("/access-denied"));

    await expect(GET(makeRequest(), PARAMS)).rejects.toMatchObject({
      digest: expect.stringContaining("/access-denied"),
    });
    expect(mocks.requireRole).toHaveBeenCalledWith(["dispatcher", "admin"]);
    expect(mocks.getDispatchBatch).not.toHaveBeenCalled();
    expect(mocks.recordBatchGenerated).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing batch without recording a generation event", async () => {
    mocks.requireRole.mockResolvedValue({ uid: "staff-1", profile: {} });
    mocks.getDispatchBatch.mockResolvedValue(null);

    const response = await GET(makeRequest(), PARAMS);

    expect(response.status).toBe(404);
    expect(mocks.renderDispatchBatchPdf).not.toHaveBeenCalled();
    expect(mocks.recordBatchGenerated).not.toHaveBeenCalled();
  });

  it("streams a no-store PDF and records the download as an audited event", async () => {
    mocks.requireRole.mockResolvedValue({ uid: "staff-1", profile: {} });
    mocks.getDispatchBatch.mockResolvedValue({
      id: "b1",
      driverId: "driver-1",
      driverDisplayName: "E2E Driver",
    });
    mocks.getRequestsForDispatchBatch.mockResolvedValue([]);
    mocks.getAllDriverRegistryEntries.mockResolvedValue([]);
    mocks.buildDispatchBatchPdfData.mockReturnValue({
      generatedAt: "2026-09-14T00:00:00.000Z",
    });
    mocks.renderDispatchBatchPdf.mockResolvedValue(Buffer.from("%PDF-fake"));

    const response = await GET(makeRequest(), PARAMS);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.recordBatchGenerated).toHaveBeenCalledWith("b1", "staff-1");
  });
});
