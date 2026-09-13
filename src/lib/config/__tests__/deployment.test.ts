import { describe, expect, it } from "vitest";

import {
  isDeployedVercel,
  isEmulatorMode,
  resolveDeployment,
} from "../deployment";

/**
 * Deployment-target resolution (issue #54). Every case passes an explicit env,
 * so the matrix is deterministic regardless of the shell running the tests.
 */

describe("resolveDeployment", () => {
  it("treats Vercel production/preview as deployed", () => {
    expect(resolveDeployment({ VERCEL_ENV: "production" })).toMatchObject({
      target: "production",
      isDeployed: true,
    });
    expect(resolveDeployment({ VERCEL_ENV: "preview" })).toMatchObject({
      target: "preview",
      isDeployed: true,
    });
  });

  it("classifies NODE_ENV=test as a non-deployed test target", () => {
    expect(resolveDeployment({ NODE_ENV: "test" })).toMatchObject({
      target: "test",
      isDeployed: false,
    });
  });

  it("classifies a bare environment as non-deployed development", () => {
    expect(resolveDeployment({})).toMatchObject({
      target: "development",
      isDeployed: false,
    });
  });

  it("treats a local production build (no VERCEL_ENV) as production but NOT deployed", () => {
    expect(resolveDeployment({ NODE_ENV: "production" })).toMatchObject({
      target: "production",
      isDeployed: false,
    });
  });

  it("detects emulator mode from server emulator hosts", () => {
    const d = resolveDeployment({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    expect(d.isEmulator).toBe(true);
    expect(d.isDeployed).toBe(false);
    expect(
      isEmulatorMode({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    ).toBe(true);
    expect(isEmulatorMode({})).toBe(false);
  });

  it("lets a deployed Vercel env win even if an emulator host is somehow present", () => {
    const d = resolveDeployment({
      VERCEL_ENV: "production",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    // Still deployed (the Firebase admin guard treats this combination as a
    // hard error separately); isEmulator is reported truthfully.
    expect(d.isDeployed).toBe(true);
    expect(d.isEmulator).toBe(true);
  });

  it("isDeployedVercel mirrors the resolved isDeployed flag", () => {
    expect(isDeployedVercel({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isDeployedVercel({ NODE_ENV: "development" })).toBe(false);
  });
});
