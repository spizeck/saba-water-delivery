import { describe, expect, it } from "vitest";

import {
  confirmationDeadline,
  isConfirmationWindowExpired,
} from "@/lib/domain/deliveryConfirmation";

const deliveredAt = new Date("2026-08-20T12:00:00.000Z");

describe("confirmationDeadline", () => {
  it("adds the configured window in hours to the delivery time", () => {
    expect(confirmationDeadline(deliveredAt, 24).toISOString()).toBe(
      "2026-08-21T12:00:00.000Z",
    );
  });

  it("defaults to the centralized 24-hour app config window", () => {
    expect(confirmationDeadline(deliveredAt).toISOString()).toBe(
      "2026-08-21T12:00:00.000Z",
    );
  });
});

describe("isConfirmationWindowExpired", () => {
  it("is not expired within the window", () => {
    const now = new Date(deliveredAt.getTime() + 23 * 60 * 60 * 1000);
    expect(isConfirmationWindowExpired(deliveredAt, now, 24)).toBe(false);
  });

  it("is expired exactly at the deadline", () => {
    const now = new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000);
    expect(isConfirmationWindowExpired(deliveredAt, now, 24)).toBe(true);
  });

  it("is expired well after the window", () => {
    const now = new Date(deliveredAt.getTime() + 48 * 60 * 60 * 1000);
    expect(isConfirmationWindowExpired(deliveredAt, now, 24)).toBe(true);
  });

  it("uses the centralized 24-hour default window", () => {
    const justUnder = new Date(deliveredAt.getTime() + 23.9 * 60 * 60 * 1000);
    const justOver = new Date(deliveredAt.getTime() + 24.1 * 60 * 60 * 1000);
    expect(isConfirmationWindowExpired(deliveredAt, justUnder)).toBe(false);
    expect(isConfirmationWindowExpired(deliveredAt, justOver)).toBe(true);
  });
});
