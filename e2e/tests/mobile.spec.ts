import { expect, type Page, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import { resetToBaseline, seedWaterRequest } from "../support/seed";

test.use({ viewport: { width: 390, height: 844 } });

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

test.describe("mobile viewport smoke", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("resident request form remains usable on a phone-width viewport", async ({
    page,
  }) => {
    await loginAs(page, "resident");

    await expect(
      page.getByRole("heading", { name: "Request water" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review & Confirm Request" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("driver delivery controls remain usable on a phone-width viewport", async ({
    page,
  }) => {
    await seedWaterRequest({
      status: "claimed",
      loads: 1,
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "driver");

    await expect(
      page.getByRole("heading", { name: "Assigned Deliveries (1)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Water collected" }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
