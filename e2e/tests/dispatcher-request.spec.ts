import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import { getLatestRequestForCustomer, resetToBaseline } from "../support/seed";

/**
 * Dispatcher manual request creation for an existing resident: search → select
 * → (change requestor) → review → create. Covers the requestor-selection UX
 * (result list collapses, selected card appears, "Change" resets) and confirms
 * a dispatcher-sourced request is persisted with the normal-urgency default.
 */
test.describe("dispatcher manual request creation", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("creates a request for a searched existing resident", async ({
    page,
  }) => {
    await loginAs(page, "dispatcher");
    await page.goto("/dispatcher/new");

    await expect(
      page.getByRole("heading", { name: "Requestor" }),
    ).toBeVisible();

    // Search and select the existing resident.
    const search = page.getByPlaceholder("Search by name, phone, or email...");
    await search.fill("E2E Resident");
    await page.getByRole("button", { name: /E2E Resident/ }).click();

    // The result list collapses and the selected requestor card appears.
    await expect(page.getByText("Selected requestor")).toBeVisible();
    await expect(search).toHaveCount(0);

    // "Change" returns to search, then reselect.
    await page.getByRole("button", { name: "Change" }).click();
    const search2 = page.getByPlaceholder("Search by name, phone, or email...");
    await expect(search2).toBeVisible();
    await search2.fill("E2E Resident");
    await page.getByRole("button", { name: /E2E Resident/ }).click();
    await expect(page.getByText("Selected requestor")).toBeVisible();

    // Delivery location is prefilled from the resident's canonical profile.
    await expect(page.getByLabel("Village/area")).toHaveValue("Windwardside");

    // Review and create (1 load + normal urgency are the defaults).
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(
      page.getByRole("heading", { name: "Review request" }),
    ).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create Request" }).click();

    // Success state.
    await expect(
      page.getByRole("button", { name: "Back to dashboard" }),
    ).toBeVisible();

    // Persisted as a dispatcher-sourced request with the normal-urgency default.
    const latest = await getLatestRequestForCustomer(E2E_ACCOUNTS.resident.uid);
    expect(latest).not.toBeNull();
    expect(latest!.data.source).toBe("dispatcher");
    expect(latest!.data.createdBy).toBe(E2E_ACCOUNTS.dispatcher.uid);
    expect(latest!.data.loads).toBe(1);
    expect(latest!.data.dispatchPriority).toBe("normal");
  });
});
