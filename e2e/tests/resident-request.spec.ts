import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import { getLatestRequestForCustomer, resetToBaseline } from "../support/seed";

/**
 * Resident water-request creation — the core resident journey. The seeded
 * resident has a complete, canonical profile, so the request form is available
 * immediately. Firestore is reset before each test so the one-active-request
 * rule never leaks state between tests.
 */
test.describe("resident request creation", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("submits a 1-load request with notes and it becomes the active request", async ({
    page,
  }) => {
    await loginAs(page, "resident");

    await expect(
      page.getByRole("heading", { name: "Request water" }),
    ).toBeVisible();

    // 1 load is the default selection; add optional notes.
    await page
      .getByLabel("Notes / Comments (optional)")
      .fill("Please deliver in the morning.");
    await page
      .getByRole("button", { name: "Review & Confirm Request" })
      .click();

    // Confirmation step shows the derived quantity.
    await expect(
      page.getByRole("heading", { name: "Confirm your request" }),
    ).toBeVisible();
    await expect(page.getByText("1 load (1,000 gallons)")).toBeVisible();

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request Water" }).click();

    // After submission the active request is shown on the resident portal.
    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();
    await expect(page.getByText("1 load (1,000 gallons)")).toBeVisible();

    // Firestore state is correct.
    const latest = await getLatestRequestForCustomer(E2E_ACCOUNTS.resident.uid);
    expect(latest).not.toBeNull();
    expect(latest!.data.loads).toBe(1);
    expect(latest!.data.gallons).toBe(1000);
    expect(latest!.data.requestNotes).toBe("Please deliver in the morning.");
    expect(latest!.data.source).toBe("resident");
    expect(latest!.data.customerId).toBe(E2E_ACCOUNTS.resident.uid);
  });

  test("submits a 2-load request and the quantity is 2,000 gallons", async ({
    page,
  }) => {
    await loginAs(page, "resident");

    await page.getByRole("radio", { name: "2 loads (2,000 gallons)" }).check();
    await page
      .getByRole("button", { name: "Review & Confirm Request" })
      .click();

    await expect(page.getByText("2 loads (2,000 gallons)")).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request Water" }).click();

    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();

    const latest = await getLatestRequestForCustomer(E2E_ACCOUNTS.resident.uid);
    expect(latest!.data.loads).toBe(2);
    expect(latest!.data.gallons).toBe(2000);
  });
});
