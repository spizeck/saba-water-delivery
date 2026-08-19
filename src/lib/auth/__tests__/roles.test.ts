import { describe, expect, it } from "vitest";

import { isUserRole, toUserRoles } from "@/lib/auth/roles";

describe("roles", () => {
  describe("isUserRole", () => {
    it("accepts canonical roles", () => {
      expect(isUserRole("resident")).toBe(true);
      expect(isUserRole("driver")).toBe(true);
      expect(isUserRole("dispatcher")).toBe(true);
      expect(isUserRole("admin")).toBe(true);
      expect(isUserRole("viewer")).toBe(true);
    });

    it("rejects non-role strings", () => {
      expect(isUserRole("superuser")).toBe(false);
      expect(isUserRole("")).toBe(false);
    });

    it("rejects non-strings", () => {
      expect(isUserRole(null)).toBe(false);
      expect(isUserRole(undefined)).toBe(false);
      expect(isUserRole(42)).toBe(false);
    });
  });

  describe("toUserRoles", () => {
    it("returns the canonical roles array when valid", () => {
      expect(toUserRoles(["resident", "admin", "driver"]).sort()).toEqual(
        ["admin", "driver", "resident"].sort(),
      );
    });

    it("filters out invalid values", () => {
      expect(toUserRoles(["resident", "superuser", 123, null])).toEqual(["resident"]);
    });

    it("defaults to resident when not an array", () => {
      expect(toUserRoles(null)).toEqual(["resident"]);
      expect(toUserRoles("admin")).toEqual(["resident"]);
      expect(toUserRoles(undefined)).toEqual(["resident"]);
    });
  });
});
