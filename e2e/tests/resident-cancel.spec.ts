import { expect, test } from "@playwright/test";

import { loginAs } from "../support/auth";
import { E2E_ACCOUNTS } from "../support/config";
import {
  db,
  getRequestData,
  getRequestEvents,
  resetToBaseline,
  seedWaterRequest,
} from "../support/seed";

/**
 * Resident self-service cancellation (issue #23). A resident may cancel
 * their own request only while it is still pre-dispatch, and only after
 * an explicit confirmation — never one-click. The server transaction
 * remains the real guard, so a stale page that still shows the button
 * is rejected rather than allowed to undo a driver's claim.
 */
test.describe("resident request cancellation", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  test("resident confirms cancellation and the request leaves the active slot", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({ status: "available" });
    await loginAs(page, "resident");

    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();

    // First click only opens the confirmation — no one-click cancel.
    await page.getByRole("button", { name: "Cancel Request" }).click();
    const confirm = page.getByRole("group", { name: "Cancel water request?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/submit a new request/i)).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel Request" }).click();

    // The active slot frees up and the request form returns — no reload
    // needed — so the resident can request water again immediately.
    await expect(
      page.getByRole("heading", { name: "Request water" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).not.toBeVisible();

    // Persisted as a normal cancellation, attributed to the resident.
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("cancelled");

    const events = await getRequestEvents(
      requestId,
      "request_cancelled_by_resident",
    );
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(E2E_ACCOUNTS.resident.uid);
    expect(events[0].actorRole).toBe("resident");

    // History keeps the cancelled request with its usual label.
    await expect(
      page.getByRole("heading", { name: "Request history" }),
    ).toBeVisible();
    await expect(page.getByText("Cancelled").first()).toBeVisible();
  });

  test("resident can cancel a request still waiting for a preferred driver", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({
      status: "preferred_driver_hold",
    });
    await loginAs(page, "resident");

    await page.getByRole("button", { name: "Cancel Request" }).click();
    await page
      .getByRole("group", { name: "Cancel water request?" })
      .getByRole("button", { name: "Cancel Request" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Request water" }),
    ).toBeVisible();
    expect((await getRequestData(requestId))?.status).toBe("cancelled");
  });

  test("Keep Request backs out of the confirmation without cancelling", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({ status: "available" });
    await loginAs(page, "resident");

    await page.getByRole("button", { name: "Cancel Request" }).click();
    const confirm = page.getByRole("group", { name: "Cancel water request?" });
    await confirm.getByRole("button", { name: "Keep Request" }).click();

    await expect(confirm).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();
    expect((await getRequestData(requestId))?.status).toBe("available");
  });

  test("no cancel option once a driver is assigned", async ({ page }) => {
    await seedWaterRequest({
      status: "claimed",
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });
    await loginAs(page, "resident");

    await expect(
      page.getByRole("heading", { name: "Active request" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel Request" }),
    ).not.toBeVisible();
  });

  test("a stale-page cancellation after a driver claim is rejected cleanly", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({ status: "available" });
    await loginAs(page, "resident");

    await expect(
      page.getByRole("button", { name: "Cancel Request" }),
    ).toBeVisible();

    // A driver claims the request after the resident's page has loaded —
    // the button on screen is now stale.
    await db().collection("waterRequests").doc(requestId).update({
      status: "claimed",
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
      claimedAt: new Date(),
    });

    await page.getByRole("button", { name: "Cancel Request" }).click();
    const confirm = page.getByRole("group", { name: "Cancel water request?" });
    await confirm.getByRole("button", { name: "Cancel Request" }).click();

    await expect(confirm.getByRole("alert")).toContainText(
      "already been assigned for delivery",
    );

    // The claim is untouched — the cancellation never overwrote it.
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("claimed");
    expect(data?.assignedDriverId).toBe(E2E_ACCOUNTS.driver.uid);
    expect(await getRequestEvents(requestId)).toHaveLength(0);
  });
});
