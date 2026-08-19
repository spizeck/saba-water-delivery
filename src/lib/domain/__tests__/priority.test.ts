import { describe, expect, it } from "vitest";

import {
  determineInitialDispatchPriority,
  isValidDispatchPriority,
  priorityRankFor,
} from "@/lib/domain/priority";

describe("priority", () => {
  describe("priorityRankFor", () => {
    it("ranks critical highest (lowest number)", () => {
      expect(priorityRankFor("critical")).toBe(0);
      expect(priorityRankFor("urgent")).toBe(1);
      expect(priorityRankFor("normal")).toBe(2);
    });

    it("orders correctly for Firestore sorting", () => {
      const priorities = ["normal", "critical", "urgent"] as const;
      const ranks = priorities.map(priorityRankFor);
      expect(ranks).toEqual([2, 0, 1]);
    });
  });

  describe("isValidDispatchPriority", () => {
    it("accepts only valid priority strings", () => {
      expect(isValidDispatchPriority("critical")).toBe(true);
      expect(isValidDispatchPriority("urgent")).toBe(true);
      expect(isValidDispatchPriority("normal")).toBe(true);
      expect(isValidDispatchPriority("high")).toBe(false);
      expect(isValidDispatchPriority(null)).toBe(false);
      expect(isValidDispatchPriority(undefined)).toBe(false);
    });
  });

  describe("determineInitialDispatchPriority", () => {
    it("critical: resident reports out of water", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "out",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });

    it("critical: vulnerable circumstance regardless of supply", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "more_than_2_days",
        vulnerableCircumstances: ["elderly"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });

    it("urgent: less than 1 day of supply", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "less_than_1_day",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("urgent");
    });

    it("urgent: 1-2 days of supply", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "1_to_2_days",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("urgent");
    });

    it("caps bare 'critical' self-report at urgent", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "more_than_2_days",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "critical",
      });
      expect(result.priority).toBe("urgent");
    });

    it("normal: no urgent or critical indicators", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "more_than_2_days",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("normal");
    });

    it("critical out-of-water outranks urgent self-report", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "out",
        vulnerableCircumstances: ["none"],
        reportedUrgency: "critical",
      });
      expect(result.priority).toBe("critical");
    });

    it("multiple non-none vulnerable circumstances still critical", () => {
      const result = determineInitialDispatchPriority({
        remainingSupply: "more_than_2_days",
        vulnerableCircumstances: ["medical_need", "infant_or_young_child"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });
  });
});
