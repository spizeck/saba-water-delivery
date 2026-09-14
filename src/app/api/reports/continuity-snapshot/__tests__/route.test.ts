import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for GET /api/reports/continuity-snapshot — the staff-only manual
 * continuity-report download. The critical invariant is the authorization
 * boundary (`requireRole(["dispatcher", "admin"])` runs before any report
 * generation) plus the response contract: a streamed, non-cached PDF.
 */

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  generateContinuityReportData: vi.fn(),
  renderContinuityReportPdf: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/domain/continuityReport", () => ({
  generateContinuityReportData: mocks.generateContinuityReportData,
}));
vi.mock("@/lib/reports/continuityReportPdf", () => ({
  renderContinuityReportPdf: mocks.renderContinuityReportPdf,
  continuityReportPdfFilename: () => "continuity-2026-09-14.pdf",
}));

import { GET } from "@/app/api/reports/continuity-snapshot/route";

function makeRequest() {
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/reports/continuity-snapshot",
  );
}

/** Error shape `unstable_rethrow` recognizes as a real Next.js redirect. */
function redirectError(url: string): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;replace;${url};307;`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/continuity-snapshot", () => {
  it("gates report generation behind the staff role check", async () => {
    mocks.requireRole.mockRejectedValue(redirectError("/access-denied"));

    await expect(GET(makeRequest())).rejects.toMatchObject({
      digest: expect.stringContaining("/access-denied"),
    });
    expect(mocks.requireRole).toHaveBeenCalledWith(["dispatcher", "admin"]);
    expect(mocks.generateContinuityReportData).not.toHaveBeenCalled();
  });

  it("streams a no-store PDF attachment for authorized staff", async () => {
    mocks.requireRole.mockResolvedValue({ uid: "staff-1", profile: {} });
    mocks.generateContinuityReportData.mockResolvedValue({
      generatedAt: "2026-09-14T00:00:00.000Z",
      unassigned: [],
      assigned: [],
    });
    mocks.renderContinuityReportPdf.mockResolvedValue(Buffer.from("%PDF-fake"));

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "continuity-2026-09-14.pdf",
    );
  });
});
