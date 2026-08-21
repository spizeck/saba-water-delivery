import { describe, expect, it } from "vitest";

import { buildWaterSituationSnapshot } from "@/lib/domain/waterSituation";

describe("buildWaterSituationSnapshot", () => {
  it("Normal is accepted without a Critical explanation", () => {
    const snapshot = buildWaterSituationSnapshot({
      reportedUrgency: "normal",
      vulnerableCircumstances: [],
      criticalExplanation: null,
    });
    expect(snapshot.reportedUrgency).toBe("normal");
    expect(snapshot.criticalExplanation).toBeNull();
  });

  it("Critical with a blank explanation is rejected", () => {
    expect(() =>
      buildWaterSituationSnapshot({
        reportedUrgency: "critical",
        vulnerableCircumstances: [],
        criticalExplanation: "",
      }),
    ).toThrow("CRITICAL_EXPLANATION_REQUIRED");
  });

  it("Critical with a missing explanation is rejected", () => {
    expect(() =>
      buildWaterSituationSnapshot({
        reportedUrgency: "critical",
        vulnerableCircumstances: [],
      }),
    ).toThrow("CRITICAL_EXPLANATION_REQUIRED");
  });

  it("Critical with a whitespace-only explanation is rejected", () => {
    expect(() =>
      buildWaterSituationSnapshot({
        reportedUrgency: "critical",
        vulnerableCircumstances: [],
        criticalExplanation: "   \n\t  ",
      }),
    ).toThrow("CRITICAL_EXPLANATION_REQUIRED");
  });

  it("Critical with an explanation is accepted and trimmed", () => {
    const snapshot = buildWaterSituationSnapshot({
      reportedUrgency: "critical",
      vulnerableCircumstances: [],
      criticalExplanation: "  Out of water and elderly resident on site.  ",
    });
    expect(snapshot.reportedUrgency).toBe("critical");
    expect(snapshot.criticalExplanation).toBe("Out of water and elderly resident on site.");
  });

  it("discards a stale Critical explanation when urgency is Normal", () => {
    const snapshot = buildWaterSituationSnapshot({
      reportedUrgency: "normal",
      vulnerableCircumstances: [],
      criticalExplanation: "This should never be stored.",
    });
    expect(snapshot.criticalExplanation).toBeNull();
  });

  it("accepts Hotel or Restaurant as a canonical vulnerable circumstance", () => {
    const snapshot = buildWaterSituationSnapshot({
      reportedUrgency: "normal",
      vulnerableCircumstances: ["hotel_or_restaurant"],
      criticalExplanation: null,
    });
    expect(snapshot.vulnerableCircumstances).toEqual(["hotel_or_restaurant"]);
  });

  it("rejects a non-positive-integer personsAffected", () => {
    expect(() =>
      buildWaterSituationSnapshot({
        reportedUrgency: "normal",
        vulnerableCircumstances: [],
        personsAffected: 0,
      }),
    ).toThrow("INVALID_PERSONS_AFFECTED");
  });
});
