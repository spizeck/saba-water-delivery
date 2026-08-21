import { describe, expect, it } from "vitest";

import { evaluateDeliveryProfileReminder } from "@/lib/domain/deliveryProfileReminder";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const completeProfile = {
  phone: "+599 000 0001",
  village: "The Bottom",
  deliveryDirections: "White house across from the church.",
};

describe("evaluateDeliveryProfileReminder", () => {
  it("brand-new resident: complete profile, never confirmed, no completed deliveries -> shows", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: null,
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(true);
    expect(result.mandatory).toBe(false);
  });

  it("recently confirmed profile (10 days ago) -> does not show", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: daysAgo(10),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(false);
  });

  it("old confirmation (46 days ago), no newer delivery -> shows", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: daysAgo(46),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(true);
    expect(result.mandatory).toBe(false);
  });

  it("recent completed delivery (20 days ago) refreshes an old confirmation (60 days ago) -> does not show", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: daysAgo(60),
      lastConfirmedDeliveryAt: daysAgo(20),
      now: NOW,
    });
    expect(result.show).toBe(false);
  });

  it("old completed delivery (46 days ago), no newer profile confirmation -> shows", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: null,
      lastConfirmedDeliveryAt: daysAgo(46),
      now: NOW,
    });
    expect(result.show).toBe(true);
  });

  it("delivery information saved today (fresh confirmation) -> does not show", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: daysAgo(0),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(false);
  });

  it("exactly at the 45-day boundary -> shows (>= 45 days)", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: daysAgo(45),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(true);
  });

  it("missing phone -> mandatory review state regardless of confirmation history", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      phone: "",
      deliveryProfileConfirmedAt: daysAgo(1),
      lastConfirmedDeliveryAt: daysAgo(1),
      now: NOW,
    });
    expect(result.show).toBe(true);
    expect(result.mandatory).toBe(true);
    expect(result.missingFields).toEqual(["phone"]);
  });

  it("missing village -> mandatory review state", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      village: "   ",
      deliveryProfileConfirmedAt: daysAgo(1),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(true);
    expect(result.mandatory).toBe(true);
    expect(result.missingFields).toEqual(["village"]);
  });

  it("missing delivery directions -> mandatory review state", () => {
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryDirections: null,
      deliveryProfileConfirmedAt: daysAgo(1),
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.show).toBe(true);
    expect(result.mandatory).toBe(true);
    expect(result.missingFields).toEqual(["deliveryDirections"]);
  });

  it("multiple missing fields are all reported", () => {
    const result = evaluateDeliveryProfileReminder({
      phone: null,
      village: null,
      deliveryDirections: "Some directions",
      deliveryProfileConfirmedAt: null,
      lastConfirmedDeliveryAt: null,
      now: NOW,
    });
    expect(result.mandatory).toBe(true);
    expect(result.missingFields).toEqual(["phone", "village"]);
  });

  it("an auto-confirmed delivery counts the same as any other confirmed delivery (recent -> does not show)", () => {
    // The pure helper only cares about the request's confirmedAt value —
    // whether it got there via customer confirmation or the 24-hour
    // auto-confirmation timeout is indistinguishable at this layer,
    // which is correct: both set status "confirmed" with a confirmedAt.
    const result = evaluateDeliveryProfileReminder({
      ...completeProfile,
      deliveryProfileConfirmedAt: null,
      lastConfirmedDeliveryAt: daysAgo(5),
      now: NOW,
    });
    expect(result.show).toBe(false);
  });
});
