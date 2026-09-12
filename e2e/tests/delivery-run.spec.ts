import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  newDispatchBatchId,
  resetToBaseline,
  seedDispatchBatch,
  seedWaterRequest,
} from "../support/seed";

/**
 * Delivery Run (Batch Dispatch) detail. Seeds a run containing one still-claimed
 * request and one already-delivered (awaiting-confirmation) request, then opens
 * the run as a dispatcher. This protects the lifecycle behaviour that a
 * delivered/awaiting-confirmation item must NOT block the run or hide the
 * remaining physical work. Also checks the run-sheet PDF endpoint.
 */
test.describe("delivery run detail", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("lists claimed and delivered requests together and serves the run-sheet PDF", async ({
    page,
  }) => {
    const batchId = newDispatchBatchId();
    const claimedId = await seedWaterRequest({
      status: "claimed",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
      dispatchBatchId: batchId,
      batchSequence: 1,
      village: "The Bottom",
    });
    const deliveredId = await seedWaterRequest({
      status: "delivered",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
      dispatchBatchId: batchId,
      batchSequence: 2,
      village: "Windwardside",
    });
    await seedDispatchBatch({
      id: batchId,
      requestIds: [claimedId, deliveredId],
    });

    await loginAs(page, "dispatcher");
    await page.goto(`/dispatcher/batches/${batchId}`);

    await expect(
      page.getByRole("heading", { name: "Delivery Run — E2E Driver" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Deliveries (2)" }),
    ).toBeVisible();

    // The still-claimed item shows outstanding work; the delivered item shows
    // awaiting-confirmation. Both coexist — a delivered item does not block the
    // run's remaining physical work.
    await expect(page.getByText("Not yet delivered")).toBeVisible();
    await expect(
      page.getByText("Delivered — awaiting confirmation"),
    ).toBeVisible();
    // With one request still claimed the run reads as In Progress.
    await expect(page.getByText("In Progress")).toBeVisible();

    // The run-sheet PDF endpoint returns a PDF. Fetch it from within the page
    // so the browser attaches the dispatcher session cookie (an out-of-page
    // APIRequestContext would drop the Secure cookie over http and be
    // redirected to login).
    const pdf = await page.evaluate(async (id) => {
      const res = await fetch(`/api/dispatcher/batches/${id}/pdf`);
      const bytes = await res.arrayBuffer();
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        length: bytes.byteLength,
      };
    }, batchId);
    expect(pdf.status).toBe(200);
    expect(pdf.contentType).toContain("application/pdf");
    expect(pdf.length).toBeGreaterThan(0);
  });
});
