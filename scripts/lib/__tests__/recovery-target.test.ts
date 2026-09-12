import { describe, expect, it } from "vitest";

import { argValue, resolveVerifyTarget } from "../recovery-target.mjs";

/**
 * Tests for the disaster-recovery validator's target resolution (issue #35).
 * The load-bearing rule: a stale FIRESTORE_EMULATOR_HOST alongside explicit
 * cloud target config must be rejected (exit 2 in the script) rather than
 * silently validating an empty local emulator and reporting a false pass.
 */

const NODE = ["node", "verify-recovery.mjs"];

describe("argValue", () => {
  it("reads --flag=value and --flag value", () => {
    expect(argValue([...NODE, "--database=recovery-1"], "--database")).toBe(
      "recovery-1",
    );
    expect(argValue([...NODE, "--database", "recovery-2"], "--database")).toBe(
      "recovery-2",
    );
    expect(argValue([...NODE], "--database")).toBeUndefined();
  });
});

describe("resolveVerifyTarget", () => {
  it("allows a pure emulator drill (emulator config only)", () => {
    const target = resolveVerifyTarget(
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      NODE,
    );
    expect(target).toEqual({
      mode: "emulator",
      emulatorHost: "127.0.0.1:8080",
    });
  });

  it("allows a cloud database with a service-account file (no emulator host)", () => {
    const target = resolveVerifyTarget({}, [
      ...NODE,
      "--service-account-file=/keys/sa.json",
      "--database=recovery-20260912",
    ]);
    expect(target).toEqual({
      mode: "service-account-file",
      serviceAccountFile: "/keys/sa.json",
      databaseId: "recovery-20260912",
    });
  });

  it("allows a cloud database with ADC (no emulator host)", () => {
    const target = resolveVerifyTarget(
      { GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json" },
      [...NODE, "--database=recovery-20260912"],
    );
    expect(target).toEqual({ mode: "adc", databaseId: "recovery-20260912" });
  });

  it("allows ADC via FIREBASE_DATABASE_ID env for the database (no emulator host)", () => {
    const target = resolveVerifyTarget(
      {
        GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json",
        FIREBASE_DATABASE_ID: "recovery-1",
      },
      NODE,
    );
    expect(target).toEqual({ mode: "adc", databaseId: "recovery-1" });
  });

  it("rejects emulator host + --database", () => {
    const target = resolveVerifyTarget(
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      [...NODE, "--database=recovery-1"],
    );
    expect("error" in target).toBe(true);
    expect((target as { error: string }).error).toContain("--database");
    expect((target as { error: string }).error).toContain(
      "FIRESTORE_EMULATOR_HOST",
    );
  });

  it("rejects emulator host + --service-account-file", () => {
    const target = resolveVerifyTarget(
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      [...NODE, "--service-account-file=/keys/sa.json"],
    );
    expect("error" in target).toBe(true);
    expect((target as { error: string }).error).toContain(
      "--service-account-file",
    );
  });

  it("rejects emulator host + GOOGLE_APPLICATION_CREDENTIALS", () => {
    const target = resolveVerifyTarget(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json",
      },
      NODE,
    );
    expect("error" in target).toBe(true);
    expect((target as { error: string }).error).toContain(
      "GOOGLE_APPLICATION_CREDENTIALS",
    );
  });

  it("rejects emulator host + FIREBASE_DATABASE_ID env", () => {
    const target = resolveVerifyTarget(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_DATABASE_ID: "recovery-1",
      },
      NODE,
    );
    expect("error" in target).toBe(true);
    expect((target as { error: string }).error).toContain(
      "FIREBASE_DATABASE_ID",
    );
  });

  it("errors when no target is configured at all", () => {
    const target = resolveVerifyTarget({}, NODE);
    expect("error" in target).toBe(true);
    expect((target as { error: string }).error).toContain(
      "No target configured",
    );
  });
});
