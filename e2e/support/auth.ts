/**
 * Authentication helpers for E2E specs (issue #34).
 *
 * `loginAs` drives the REAL login UI: it fills the email/password form, which
 * signs in against the Firebase Auth emulator, exchanges the resulting ID token
 * for a session cookie via the real `POST /api/auth/session`, and lands on the
 * portal. Nothing about production auth is bypassed — only the identity
 * provider is the local emulator instead of live Google. This is why the suite
 * gives real confidence in auth/session changes.
 */

import { expect, type Page } from "@playwright/test";

import { E2E_ACCOUNTS, type E2eRole } from "./config";

/** Signs in as the given seeded role through the real login form. */
export async function loginAs(page: Page, role: E2eRole): Promise<void> {
  const account = E2E_ACCOUNTS[role];
  await page.goto(`/login?portal=${account.portal}`);

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await page.waitForURL(new RegExp(`/${account.portal}(?:$|[/?])`), {
    timeout: 30_000,
  });
}

/** Clicks the portal "Log out" control and waits for the login page. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login(?:$|[/?])/, { timeout: 30_000 });
}

/** Asserts the given portal path redirects an unauthenticated visitor to /login. */
export async function expectRedirectToLogin(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(path);
  await page.waitForURL(/\/login(?:$|[/?])/, { timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
}
