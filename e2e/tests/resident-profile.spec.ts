import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import { getUserProfileData, resetToBaseline } from "../support/seed";

/**
 * Resident profile / village regression. Guards the known issue where the saved
 * village did not survive a re-render (the ProfileForm remounts on the saved
 * `village` key). A canonical village chosen and saved must remain selected
 * after the server action revalidates and after a full reload.
 */
test.describe("resident profile village persistence", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("a chosen canonical village stays selected after save and reload", async ({
    page,
  }) => {
    await loginAs(page, "resident");

    const villageSelect = page.getByLabel("Village/area");
    await expect(villageSelect).toBeVisible();
    // Seeded starting value.
    await expect(villageSelect).toHaveValue("Windwardside");

    await villageSelect.selectOption("The Bottom");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Profile saved.")).toBeVisible();
    // Selected village remains visible after the save/re-render.
    await expect(page.getByLabel("Village/area")).toHaveValue("The Bottom");

    // And after a full reload (authoritative server state).
    await page.reload();
    await expect(page.getByLabel("Village/area")).toHaveValue("The Bottom");

    const profile = await getUserProfileData(E2E_ACCOUNTS.resident.uid);
    expect(profile?.village).toBe("The Bottom");
  });
});
