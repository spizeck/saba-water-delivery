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
 * Staff-recorded dispute for an unregistered customer (issue #50). A
 * dispatcher opens a delivered, awaiting-confirmation request that was
 * entered by staff for a customer with no account, records the dispute
 * the customer reported by phone, and the request enters the normal
 * disputed workflow — with an audit event that is clearly
 * staff-recorded, never the customer's own action.
 */
test.describe("staff-recorded dispute (unregistered customer)", () => {
  test.beforeEach(async () => {
    await resetToBaseline();
  });

  function seedUnregisteredDelivered() {
    return seedWaterRequest({
      status: "delivered",
      customerId: null,
      source: "dispatcher",
      createdBy: E2E_ACCOUNTS.dispatcher.uid,
      customerName: "Walk-in Customer",
      customerPhone: "+599 416 9999",
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });
  }

  test("shows the action on an eligible request and records the dispute", async ({
    page,
  }) => {
    const requestId = await seedUnregisteredDelivered();

    await loginAs(page, "dispatcher");
    await page.goto(`/dispatcher/${requestId}`);

    // The request is flagged unregistered and offers both staff paths:
    // confirm on the customer's behalf, or record the customer's dispute.
    await expect(page.getByText("unregistered", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm delivery (unregistered)" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Record customer dispute" }).click();

    // The panel makes the semantics explicit before the reason is entered.
    await expect(
      page.getByText("Record a dispute reported by the customer"),
    ).toBeVisible();

    const reason = "Customer called: says the water never arrived.";
    await page
      .getByPlaceholder("What did the customer report? (required)")
      .fill(reason);
    await page.getByRole("button", { name: "Record dispute" }).click();

    // Success, then the disputed workflow: status chip, reason card, and
    // the normal resolution actions appear.
    await expect(
      page.getByText(
        "Customer dispute recorded. The request is now disputed and awaiting resolution.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Customer dispute recorded by staff", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("DISPUTED", { exact: true })).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Accept delivery" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reopen for retry" }),
    ).toBeVisible();

    // Persisted: canonical disputed status + the distinct staff audit
    // event carrying the reason — never `customer_disputed`.
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("disputed");
    const events = await getRequestEvents(
      requestId,
      "customer_dispute_recorded_by_staff",
    );
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(E2E_ACCOUNTS.dispatcher.uid);
    expect(events[0].actorRole).toBe("dispatcher");
    expect(events[0].metadata).toMatchObject({ reason });
    expect(await getRequestEvents(requestId, "customer_disputed")).toHaveLength(
      0,
    );
  });

  test("does not offer the staff dispute action on a registered resident's request", async ({
    page,
  }) => {
    const requestId = await seedWaterRequest({
      status: "delivered",
      assignedDriverId: E2E_ACCOUNTS.driver.uid,
    });

    await loginAs(page, "dispatcher");
    await page.goto(`/dispatcher/${requestId}`);

    await expect(
      page.getByRole("button", { name: "Record customer dispute" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Confirm delivery (unregistered)" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/must confirm or dispute receipt in the resident portal/),
    ).toBeVisible();
  });

  test("a stale page cannot dispute a request that was confirmed meanwhile", async ({
    page,
  }) => {
    const requestId = await seedUnregisteredDelivered();

    await loginAs(page, "dispatcher");
    await page.goto(`/dispatcher/${requestId}`);
    await expect(
      page.getByRole("button", { name: "Record customer dispute" }),
    ).toBeVisible();

    // A competing staff confirmation commits while the page is stale —
    // the equivalent of another dispatcher clicking Confirm delivery.
    await db().collection("waterRequests").doc(requestId).update({
      status: "confirmed",
      confirmedAt: new Date(),
      updatedAt: new Date(),
    });

    await page.getByRole("button", { name: "Record customer dispute" }).click();
    await page
      .getByPlaceholder("What did the customer report? (required)")
      .fill("Customer says the delivery never happened.");
    await page.getByRole("button", { name: "Record dispute" }).click();

    // Clean rejection — the committed confirmation is never overwritten.
    await expect(
      page.getByText(/can no longer be disputed|status changed/i),
    ).toBeVisible();
    const data = await getRequestData(requestId);
    expect(data?.status).toBe("confirmed");
    expect(
      await getRequestEvents(requestId, "customer_dispute_recorded_by_staff"),
    ).toHaveLength(0);
  });
});
