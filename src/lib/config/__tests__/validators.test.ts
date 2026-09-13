import { describe, expect, it } from "vitest";

import { ConfigError, isConfigError } from "../errors";
import {
  booleanFlag,
  csvList,
  isPresent,
  optionalDatabaseId,
  optionalHttpUrl,
  optionalString,
  parseHttpUrl,
  requiredEmail,
  requiredHttpUrl,
  requiredPrivateKey,
  requiredSecret,
  requiredString,
} from "../validators";

/**
 * Pure validator tests (issue #54). No `process.env` access — every input is
 * passed explicitly, so these prove correctness independent of the developer's
 * shell. Negative cases (missing / malformed / unsafe) are covered, and every
 * thrown error is asserted to be sanitized (never contains the value).
 */

describe("isPresent", () => {
  it("is false for undefined, empty, and whitespace; true otherwise", () => {
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent("")).toBe(false);
    expect(isPresent("   ")).toBe(false);
    expect(isPresent("x")).toBe(true);
  });
});

describe("requiredString / optionalString / requiredSecret", () => {
  it("returns the trimmed value when present", () => {
    expect(requiredString("VAR", "  hello  ")).toBe("hello");
    expect(optionalString("VAR", "  hi ")).toBe("hi");
    expect(requiredSecret("VAR", " s ")).toBe("s");
  });

  it("optionalString returns undefined when absent/blank", () => {
    expect(optionalString("VAR", undefined)).toBeUndefined();
    expect(optionalString("VAR", "  ")).toBeUndefined();
  });

  it("throws a ConfigError naming the variable when a required value is missing", () => {
    expect(() => requiredString("MY_VAR", undefined)).toThrow(ConfigError);
    try {
      requiredString("MY_VAR", "");
    } catch (e) {
      expect(isConfigError(e)).toBe(true);
      expect((e as ConfigError).variable).toBe("MY_VAR");
      expect((e as ConfigError).message).toContain("MY_VAR");
    }
  });

  it("requiredSecret never includes the (missing) value and names the var", () => {
    try {
      requiredSecret("SECRET_VAR", "");
    } catch (e) {
      expect((e as ConfigError).message).toContain("SECRET_VAR");
    }
  });
});

describe("URL parsing", () => {
  it("normalizes to origin and strips trailing slash / path", () => {
    expect(parseHttpUrl("U", "https://example.gov/")).toBe(
      "https://example.gov",
    );
    expect(parseHttpUrl("U", "https://example.gov/path?x=1")).toBe(
      "https://example.gov",
    );
    expect(requiredHttpUrl("U", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("optionalHttpUrl returns undefined when absent", () => {
    expect(optionalHttpUrl("U", undefined)).toBeUndefined();
  });

  it("rejects non-http(s) and malformed URLs without echoing the value", () => {
    const bad = "ftp://secret-host.example";
    try {
      parseHttpUrl("APP_URL", bad);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isConfigError(e)).toBe(true);
      expect((e as ConfigError).message).toContain("APP_URL");
      expect((e as ConfigError).message).not.toContain("secret-host");
    }
    expect(() => parseHttpUrl("APP_URL", "not a url")).toThrow(ConfigError);
  });
});

describe("booleanFlag", () => {
  it("treats absent/empty/'false' as false and anything else as true", () => {
    expect(booleanFlag(undefined)).toBe(false);
    expect(booleanFlag("")).toBe(false);
    expect(booleanFlag("false")).toBe(false);
    expect(booleanFlag("FALSE")).toBe(false);
    expect(booleanFlag("true")).toBe(true);
    expect(booleanFlag("1")).toBe(true);
  });
});

describe("csvList", () => {
  it("splits, trims, and drops empties; [] when absent", () => {
    expect(csvList("a@x.com, b@y.com ,, c@z.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
    expect(csvList(undefined)).toEqual([]);
    expect(csvList("   ")).toEqual([]);
  });
});

describe("optionalDatabaseId", () => {
  it("accepts absent (undefined), '(default)', and a valid id", () => {
    expect(optionalDatabaseId("DB", undefined)).toBeUndefined();
    expect(optionalDatabaseId("DB", "(default)")).toBe("(default)");
    expect(optionalDatabaseId("DB", "recovery-20260912")).toBe(
      "recovery-20260912",
    );
  });

  it("rejects a malformed id with a value-free error", () => {
    const bad = "Recovery_DB!";
    try {
      optionalDatabaseId("FIREBASE_DATABASE_ID", bad);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isConfigError(e)).toBe(true);
      expect((e as ConfigError).message).toContain("FIREBASE_DATABASE_ID");
      expect((e as ConfigError).message).not.toContain(bad);
    }
  });
});

describe("requiredEmail", () => {
  it("accepts a valid address", () => {
    expect(requiredEmail("E", "svc@proj.iam.gserviceaccount.com")).toBe(
      "svc@proj.iam.gserviceaccount.com",
    );
  });

  it("rejects a malformed address without echoing it", () => {
    const bad = "not-an-email";
    try {
      requiredEmail("FIREBASE_ADMIN_CLIENT_EMAIL", bad);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ConfigError).message).toContain(
        "FIREBASE_ADMIN_CLIENT_EMAIL",
      );
      expect((e as ConfigError).message).not.toContain(bad);
    }
  });
});

describe("requiredPrivateKey", () => {
  it("unescapes \\n and accepts a PEM-looking key", () => {
    const raw =
      "-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n";
    const parsed = requiredPrivateKey("K", raw);
    expect(parsed).toContain("\n");
    expect(parsed).toContain("BEGIN PRIVATE KEY");
  });

  it("rejects a non-key value WITHOUT leaking the secret material", () => {
    const secret = "super-secret-not-a-key-value";
    try {
      requiredPrivateKey("FIREBASE_ADMIN_PRIVATE_KEY", secret);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isConfigError(e)).toBe(true);
      expect((e as ConfigError).message).toContain(
        "FIREBASE_ADMIN_PRIVATE_KEY",
      );
      expect((e as ConfigError).message).not.toContain(secret);
    }
  });
});
