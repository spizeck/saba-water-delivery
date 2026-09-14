import { expect, test } from "@playwright/test";

import { loginAs, logout } from "../support/auth";

/**
 * Authentication and authorization boundaries, exercised through the REAL
 * login/session flow (email/password against the Auth emulator → session
 * cookie via POST /api/auth/session → server role check). Each test runs in an
 * isolated browser context, so no session leaks between them.
 */
test.describe("authentication and authorization", () => {
  test("a resident can establish a session and reach the resident portal", async ({
    page,
  }) => {
    await loginAs(page, "resident");
    await expect(page).toHaveURL(/\/resident(?:$|[/?])/);
    await expect(
      page.getByRole("heading", { name: "Your profile" }),
    ).toBeVisible();
  });

  test("a dispatcher can establish a session and reach the dispatcher portal", async ({
    page,
  }) => {
    await loginAs(page, "dispatcher");
    await expect(page).toHaveURL(/\/dispatcher(?:$|[/?])/);
  });

  test("a driver can establish a session and reach the driver portal", async ({
    page,
  }) => {
    await loginAs(page, "driver");
    await expect(page).toHaveURL(/\/driver(?:$|[/?])/);
    await expect(page.getByRole("heading", { name: "Driver" })).toBeVisible();
  });

  test("a resident cannot access the dispatcher portal", async ({ page }) => {
    await loginAs(page, "resident");
    await page.goto("/dispatcher");
    await page.waitForURL(/\/access-denied(?:$|[/?])/);
    await expect(page).toHaveURL(/\/access-denied/);
  });

  test("logout clears access and the portal cannot be re-opened", async ({
    page,
  }) => {
    await loginAs(page, "resident");
    await expect(page).toHaveURL(/\/resident(?:$|[/?])/);

    await logout(page);
    await expect(page).toHaveURL(/\/login(?:$|[/?])/);

    // Navigating back to the protected portal must redirect to login again —
    // the session cookie is gone and back-navigation must not reopen it.
    await page.goto("/resident");
    await page.waitForURL(/\/login(?:$|[/?])/);
    await expect(
      page.getByRole("button", { name: "Log in", exact: true }),
    ).toBeVisible();
  });

  test("Facebook sign-in stays disabled — it is not a production-enabled provider", async ({
    page,
  }) => {
    await page.goto("/login?portal=resident");
    const facebook = page.getByRole("button", {
      // The button's accessible name comes from its aria-label, not the
      // visible "Continue with Facebook" text.
      name: "Facebook login will be available soon.",
    });
    await expect(facebook).toBeVisible();
    await expect(facebook).toBeDisabled();
    await expect(
      page.getByText("Continue with Facebook"),
    ).toBeVisible();
    await expect(page.getByText("Coming Soon")).toBeVisible();
  });
});
