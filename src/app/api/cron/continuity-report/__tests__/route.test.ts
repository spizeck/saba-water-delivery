import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateContinuityReportDataMock, renderContinuityReportPdfMock, sendContinuityReportEmailMock } =
  vi.hoisted(() => ({
    generateContinuityReportDataMock: vi.fn(),
    renderContinuityReportPdfMock: vi.fn(),
    sendContinuityReportEmailMock: vi.fn(),
  }));

vi.mock("@/lib/domain/continuityReport", () => ({
  generateContinuityReportData: generateContinuityReportDataMock,
}));
vi.mock("@/lib/reports/continuityReportPdf", () => ({
  renderContinuityReportPdf: renderContinuityReportPdfMock,
}));
vi.mock("@/lib/email/continuityReportEmail", () => ({
  sendContinuityReportEmail: sendContinuityReportEmailMock,
}));

import { GET } from "@/app/api/cron/continuity-report/route";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://saba-water-delivery.vercel.app/api/cron/continuity-report", {
    headers,
  });
}

describe("GET /api/cron/continuity-report", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-secret" };
    generateContinuityReportDataMock.mockReset();
    renderContinuityReportPdfMock.mockReset();
    sendContinuityReportEmailMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a request with a missing Authorization header", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(generateContinuityReportDataMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid secret", async () => {
    const response = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
    expect(generateContinuityReportDataMock).not.toHaveBeenCalled();
  });

  it("reaches the report-send flow with a valid secret and returns success", async () => {
    generateContinuityReportDataMock.mockResolvedValue({
      generatedAt: "2026-08-22T00:00:00.000Z",
      unassigned: [{}],
      assigned: [],
    });
    renderContinuityReportPdfMock.mockResolvedValue(Buffer.from("pdf"));
    sendContinuityReportEmailMock.mockResolvedValue({ ok: true });

    const response = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(generateContinuityReportDataMock).toHaveBeenCalledTimes(1);
    expect(renderContinuityReportPdfMock).toHaveBeenCalledTimes(1);
    expect(sendContinuityReportEmailMock).toHaveBeenCalledTimes(1);
  });

  it("returns a non-200 status and does not throw when email sending fails", async () => {
    generateContinuityReportDataMock.mockResolvedValue({
      generatedAt: "2026-08-22T00:00:00.000Z",
      unassigned: [],
      assigned: [],
    });
    renderContinuityReportPdfMock.mockResolvedValue(Buffer.from("pdf"));
    sendContinuityReportEmailMock.mockResolvedValue({ ok: false, error: "Resend down" });

    const response = await GET(makeRequest({ authorization: "Bearer test-secret" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Resend down");
  });

  it("allows an unauthenticated request through when CRON_SECRET is unset (documented fallback)", async () => {
    delete process.env.CRON_SECRET;
    generateContinuityReportDataMock.mockResolvedValue({
      generatedAt: "2026-08-22T00:00:00.000Z",
      unassigned: [],
      assigned: [],
    });
    renderContinuityReportPdfMock.mockResolvedValue(Buffer.from("pdf"));
    sendContinuityReportEmailMock.mockResolvedValue({ ok: true });

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
  });
});
