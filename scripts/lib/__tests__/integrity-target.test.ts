import { describe, expect, it } from "vitest";

import { resolveIntegrityTarget } from "../integrity-target.mjs";

/**
 * Target/production-safety tests for the read-only integrity diagnostic
 * (issue #52). The resolver must never let an intended cloud diagnostic
 * silently fall back to the emulator (or vice versa), must require an explicit
 * `--production` acknowledgement for cloud, must reject an ambiguous target,
 * and must never accept inline service-account JSON.
 */

describe("resolveIntegrityTarget", () => {
  it("rejects no configured target", () => {
    const r = resolveIntegrityTarget({}, []);
    expect(r).toHaveProperty("error");
  });

  it("rejects an ambiguous emulator + cloud target", () => {
    const r = resolveIntegrityTarget(
      {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        GOOGLE_APPLICATION_CREDENTIALS: "/k.json",
      },
      ["--production", "--project=p"],
    );
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/emulator/i);
  });

  it("allows a pure emulator run (no --production)", () => {
    const r = resolveIntegrityTarget(
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      [],
    );
    expect(r).toMatchObject({ mode: "emulator", production: false });
  });

  it("rejects --production against an emulator target (no cloud fallback confusion)", () => {
    const r = resolveIntegrityTarget(
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      ["--production"],
    );
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/EMULATOR/);
  });

  it("requires an explicit --production for a cloud (ADC) target", () => {
    const r = resolveIntegrityTarget(
      { GOOGLE_APPLICATION_CREDENTIALS: "/k.json", GOOGLE_CLOUD_PROJECT: "p" },
      [],
    );
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/--production/);
  });

  it("requires an explicit project for ADC cloud mode (no implicit default)", () => {
    const r = resolveIntegrityTarget(
      { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
      ["--production"],
    );
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/project/i);
  });

  it("resolves a valid ADC cloud target with --production and an explicit project", () => {
    const r = resolveIntegrityTarget(
      { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
      ["--production", "--project=my-project", "--database=prod-db"],
    );
    expect(r).toMatchObject({
      mode: "adc",
      production: true,
      projectId: "my-project",
      databaseId: "prod-db",
    });
  });

  it("resolves a service-account-file cloud target (project may come from the key file)", () => {
    const r = resolveIntegrityTarget({}, [
      "--production",
      "--service-account-file=/path/key.json",
    ]);
    expect(r).toMatchObject({
      mode: "service-account-file",
      production: true,
      projectId: null, // CLI reads project_id from the key file
      serviceAccountFile: "/path/key.json",
    });
  });

  it("rejects inline service-account JSON on the command line", () => {
    const r = resolveIntegrityTarget({}, [
      "--production",
      '--service-account={"project_id":"p"}',
    ]);
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/inline/i);
  });
});
