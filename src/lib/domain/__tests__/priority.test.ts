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
    it("critical: any vulnerable or critical circumstance", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["elderly"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });

    it("critical: essential services (commercial/business)", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["essential_services_commercial_business"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });

    it("critical: multiple vulnerable circumstances", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["medical_need", "infant_or_young_child"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });

    it("urgent: self-reported urgent", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["none"],
        reportedUrgency: "urgent",
      });
      expect(result.priority).toBe("urgent");
    });

    it("caps bare critical self-report at urgent", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["none"],
        reportedUrgency: "critical",
      });
      expect(result.priority).toBe("urgent");
    });

    it("critical outranks a bare critical urgency when vulnerable", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["medical_need"],
        reportedUrgency: "critical",
      });
      expect(result.priority).toBe("critical");
    });

    it("normal: no urgent or critical indicators", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["none"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("normal");
    });

    it("treats empty vulnerable circumstances as none", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: [],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("normal");
    });

    it("treats legacy essential_service as a critical circumstance", () => {
      const result = determineInitialDispatchPriority({
        vulnerableCircumstances: ["essential_service"],
        reportedUrgency: "normal",
      });
      expect(result.priority).toBe("critical");
    });
  });
});
