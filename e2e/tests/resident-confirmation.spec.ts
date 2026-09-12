import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  getRequestData,
  resetToBaseline,
  seedWaterRequest,
} from "../support/seed";

/**
 * Resident delivery confirmation. A delivered request awaiting confirmation is
 * seeded, then the resident opens the authenticated review route directly
 * (email deep-links are not automated — seeded state stands in) and confirms
 * receipt, moving the request to `confirmed`.
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
});
