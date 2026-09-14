import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import { resetToBaseline, seedWaterRequest } from "../support/seed";

/**
 * Viewer portal (issue #67): government oversight access is read-only and
 * PII-minimized. The viewer sees open requests and driver status but never
 * customer phone numbers, email addresses, or full delivery directions —
 * and gets no mutation controls. This spec proves those properties through
 * the real login → session → portal stack; the projection itself is
 * unit-covered by `viewerProjection.test.ts` and write-denial by
 * `firestore.rules.test.ts`.
 */
test.describe("viewer portal", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("shows open operations without customer PII and no mutation controls", async ({
    page,
  }) => {
    await seedWaterRequest({
      status: "available",
      customerName: "Oversight Resident",
      customerPhone: "+599 416 7777",
      deliveryDirections: "Secret path behind the hill.",
    });

    await loginAs(page, "viewer");

    await expect(
      page.getByRole("heading", { name: /Open Requests/ }),
    ).toBeVisible();
    await expect(page.getByText("Read-Only")).toBeVisible();

    // Oversight-appropriate fields are visible.
    const row = page.locator("tr", { has: page.getByText("Available") });
    await expect(row).toBeVisible();
    await expect(row.getByText("Windwardside")).toBeVisible();

    // Customer PII never enters the viewer payload — not the seeded phone,
    // not the delivery directions, not the resident's email.
    await expect(page.getByText("+599 416 7777")).toBeHidden();
    await expect(page.getByText("Secret path behind the hill.")).toBeHidden();
    await expect(page.getByText(E2E_ACCOUNTS.resident.email)).toBeHidden();

    // The drivers table shows oversight fields only.
    await expect(page.getByRole("heading", { name: /Drivers/ })).toBeVisible();
    await expect(page.getByText(E2E_ACCOUNTS.driver.displayName)).toBeVisible();

    // No operational controls: the only button is Log out.
    const buttons = page.getByRole("button");
    await expect(buttons).toHaveCount(1);
    await expect(buttons.first()).toHaveText(/log out/i);
  });

  test("a signed-in viewer is denied the dispatcher portal", async ({
    page,
  }) => {
    await loginAs(page, "viewer");

    await page.goto("/dispatcher");
    await page.waitForURL(/\/access-denied(?:$|[/?])/, { timeout: 30_000 });
  });
});
