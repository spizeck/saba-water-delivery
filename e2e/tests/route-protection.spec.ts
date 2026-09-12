import { expect, test } from "@playwright/test";

import { expectRedirectToLogin } from "../support/auth";

/**
 * Route protection: every portal must send an unauthenticated visitor to the
 * login page. This is the single highest-value regression guard — a routing,
 * middleware, or session change that accidentally exposed a portal would be
 * caught here.
 */
test.describe("unauthenticated route protection", () => {
  test("redirects /resident to login", async ({ page }) => {
    await expectRedirectToLogin(page, "/resident");
  });

  test("redirects /driver to login", async ({ page }) => {
    await expectRedirectToLogin(page, "/driver");
  });

  test("redirects /dispatcher to login", async ({ page }) => {
    await expectRedirectToLogin(page, "/dispatcher");
  });

  test("redirects a deep resident review link to login (preserving return path)", async ({
    page,
  }) => {
    await page.goto("/resident/review/some-request-id");
    await page.waitForURL(/\/login(?:$|[/?])/);
    // The safe returnTo is preserved so the resident lands back after signing in.
    expect(page.url()).toContain("returnTo");
  });
});
