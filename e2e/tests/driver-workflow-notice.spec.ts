import { FieldValue } from "firebase-admin/firestore";
import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_DRIVER_REGISTRY_ID } from "../support/config";
import { db, resetToBaseline } from "../support/seed";

/**
 * The versioned driver workflow-change notice (issue #123 follow-up).
 * The baseline driver is seeded already-acknowledged so other specs are
 * unaffected; these tests clear that acknowledgement to exercise the
 * first-visit modal and its server-side persistence.
 */
test.describe("driver workflow notice", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  async function clearAcknowledgement(): Promise<void> {
    await db().collection("driverRegistry").doc(E2E_DRIVER_REGISTRY_ID).update({
      workflowNoticeAcknowledgedVersion: FieldValue.delete(),
      workflowNoticeAcknowledgedAt: FieldValue.delete(),
    });
  }

  test("an unacknowledged driver sees the notice once; it persists across reloads", async ({
    page,
  }) => {
    await clearAcknowledgement();

    await loginAs(page, "driver");

    const dialog = page.getByRole("dialog", {
      name: "Driver workflow has changed",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("already assigned to you", { exact: false }),
    ).toBeVisible();

    // The only way past is the explicit acknowledgement action — there is
    // no close control and no backdrop dismissal.
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);

    // Persisted server-side: a fresh load (equivalently, another device)
    // does not show the notice again.
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the modal cannot be dismissed without acknowledging", async ({
    page,
  }) => {
    await clearAcknowledgement();
    await loginAs(page, "driver");

    const dialog = page.getByRole("dialog", {
      name: "Driver workflow has changed",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Close")).toHaveCount(0);

    // Clicking outside the dialog does nothing — no accidental dismissal.
    await page.mouse.click(10, 10);
    await expect(dialog).toBeVisible();

    // Escape does not dismiss it either.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
  });
});
