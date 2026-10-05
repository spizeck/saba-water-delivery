import { expect, test } from "@playwright/test";

import { loginAs, logout } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  getRequestData,
  resetToBaseline,
  seedWaterRequest,
} from "../support/seed";

/**
 * Dispatcher-to-driver assignment through the real UI. Proves the handoff from a
 * dispatcher action to driver-visible work: the dispatcher assigns an eligible
 * driver to an unassigned request, then that driver signs in and sees it in
 * their open work.
 *
 * Only the PREREQUISITES are seeded (users, the eligible driver registry entry +
 * meter and fill stations via `resetToBaseline`, and an unassigned `available`
 * request) — the assigned/claimed state is produced by the browser flow, not
 * seeded. The canonical direct-assign UI (`/dispatcher/<id>` → "Assign driver")
 * is used rather than a Delivery Run, because direct assignment IS the supported
 * path for handing a single request to one driver.
 */
test.describe("dispatcher assigns a driver and the driver sees the work", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("assigns an eligible driver through the UI and the request appears in the driver's open work", async ({
    page,
  }) => {
    // Prerequisite only: an unassigned, available request owned by the resident.
    const requestId = await seedWaterRequest({
      status: "available",
      loads: 1,
      village: "The Bottom",
      customerId: E2E_ACCOUNTS.resident.uid,
      customerName: E2E_ACCOUNTS.resident.displayName,
    });

    // --- Dispatcher assigns the driver through the real UI ---
    await loginAs(page, "dispatcher");
    await page.goto(`/dispatcher/${requestId}`);

    await expect(
      page.getByRole("heading", { name: "Request detail" }),
    ).toBeVisible();
    await expect(page.getByText("Available", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Assign driver" }).click();
    await page
      .locator('select[name="driverId"]')
      .selectOption({ label: E2E_ACCOUNTS.driver.displayName });
    await page.getByRole("button", { name: "Assign", exact: true }).click();

    // Dispatcher UI reflects the assignment (the assign action confirms it).
    await expect(page.getByText("Request assigned.")).toBeVisible();

    // --- The assigned driver signs in and sees the work ---
    await logout(page);
    await loginAs(page, "driver");

    await expect(
      page.getByRole("heading", { name: "Assigned Deliveries (1)" }),
    ).toBeVisible();
    // Requestor, quantity, and village are correct.
    await expect(page.getByText("1 load (1,000 gallons)")).toBeVisible();
    await expect(page.getByText("The Bottom")).toBeVisible();
    await expect(
      page.getByText(E2E_ACCOUNTS.resident.displayName),
    ).toBeVisible();

    // Firestore reflects the handoff: claimed by this driver.
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("claimed");
    expect(data?.assignedDriverId).toBe(E2E_ACCOUNTS.driver.uid);
  });
});
