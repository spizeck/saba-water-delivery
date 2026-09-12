import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  getRequestData,
  resetToBaseline,
  seedWaterRequest,
} from "../support/seed";

/**
 * Driver collection and mark-delivered flow. The precondition (a request
 * already claimed by the driver) is seeded directly so the test focuses on the
 * driver's own UI: recording water collection at the default fill station,
 * seeing progress, being blocked from delivering until all loads are collected,
 * and finally marking delivered.
 */
test.describe("driver collection and delivery", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("records collection then marks a 1-load delivery complete", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({
      status: "claimed",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "driver");

    await expect(
      page.getByRole("heading", { name: "My deliveries (1)" }),
    ).toBeVisible();
    await expect(page.getByText("1 load (1,000 gallons)")).toBeVisible();

    // Cannot mark delivered before the load is collected.
    await expect(
      page.getByText(
        "Record water collection for all loads before marking delivered.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark Delivered" }),
    ).toHaveCount(0);

    // Record collection at the default (Bottom) station.
    await page.getByRole("button", { name: "Water collected" }).first().click();
    await expect(page.getByText("Load 1 — Collected")).toBeVisible();

    // Now delivery is allowed.
    await page.getByRole("button", { name: "Mark Delivered" }).click();
    await page.getByRole("button", { name: "Yes, delivered" }).click();

    // Once delivered, the request leaves the driver's claimed list (the portal
    // revalidates and shows no active delivery).
    await expect(
      page.getByText("No deliveries available right now."),
    ).toBeVisible();

    const data = await getRequestData(requestId);
    expect(data?.status).toBe("delivered");
    expect(Array.isArray(data?.loadCollections)).toBe(true);
    expect((data?.loadCollections as unknown[]).length).toBe(1);
  });

  test("shows 1/2 partial progress before the second collection completes a 2-load delivery", async ({
    page,
  }) => {
    await seedWaterRequest({
      status: "claimed",
      loads: 2,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "driver");
    await expect(page.getByText("2 loads (2,000 gallons)")).toBeVisible();

    // Record the first of two loads.
    await page.getByRole("button", { name: "Water collected" }).first().click();
    await expect(page.getByText("Load 1 — Collected")).toBeVisible();

    // Still cannot deliver — one load remains.
    await expect(
      page.getByText(
        "Record water collection for all loads before marking delivered.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark Delivered" }),
    ).toHaveCount(0);

    // Record the second load — now delivery is unlocked.
    await page.getByRole("button", { name: "Water collected" }).first().click();
    await expect(page.getByText("Load 2 — Collected")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark Delivered" }),
    ).toBeVisible();
  });
});
