import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  getRequestData,
  getRequestEvents,
  resetToBaseline,
  seedWaterRequest,
} from "../support/seed";

/**
 * Resident delivery confirmation and dispute. A delivered request awaiting
 * confirmation is seeded, then the resident opens the authenticated review
 * route directly (email deep-links are not automated — seeded state stands in)
 * and either confirms receipt (→ `confirmed`) or reports a problem
 * (→ `disputed`). Both drive the real resident action — no post-load Firestore
 * mutation — and no real email is sent.
 */
test.describe("resident delivery confirmation", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("confirms a delivered request from the review route", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({
      status: "delivered",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "resident");
    await page.goto(`/resident/review/${requestId}`);

    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Did you receive your 1 load \(1,000 gallons\)\?/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Yes, received" }).click();

    // After confirming, the request moves to the confirmed state (the
    // confirmation prompt is replaced by the "Confirmed" status).
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Yes, received" }),
    ).toHaveCount(0);

    const data = await getRequestData(requestId);
    expect(data?.status).toBe("confirmed");
  });

  test("disputes a delivered request from the review route", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({
      status: "delivered",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "resident");
    await page.goto(`/resident/review/${requestId}`);

    await expect(
      page.getByText(/Did you receive your 1 load \(1,000 gallons\)\?/),
    ).toBeVisible();

    // Choose the dispute action, fill the required-workflow reason, and submit.
    await page.getByRole("button", { name: "No, there is a problem" }).click();
    const reason = "Only one load was delivered, not the full amount.";
    await page.getByLabel("What went wrong? (optional)").fill(reason);
    await page.getByRole("button", { name: "Report issue" }).click();

    // The request moves to the disputed state (the prompt is replaced by the
    // "Delivery issue reported" status).
    await expect(page.getByText("Delivery issue reported")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Report issue" }),
    ).toHaveCount(0);

    // Firestore persists the canonical disputed status and the dispute reason
    // metadata on the audit event.
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("disputed");
    const disputeEvents = await getRequestEvents(
      requestId,
      "customer_disputed",
    );
    expect(disputeEvents).toHaveLength(1);
    expect(disputeEvents[0].metadata).toMatchObject({ reason });
  });
});
