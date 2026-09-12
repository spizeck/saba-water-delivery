import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUTH_EMULATOR_PORT,
  E2E_PROJECT_ID,
  FIRESTORE_EMULATOR_PORT,
} from "../config";
import {
  assertEmulatorSafety,
  isLoopbackEmulatorHost,
  isSafeEmulatorProject,
} from "../safety";

/**
 * Regression coverage for the E2E production-safety guard (Aikido finding).
 * These are pure unit tests — no browser, no emulator — so they run in the
 * normal `npm run test` Vitest suite.
 */

describe("isLoopbackEmulatorHost", () => {
  it("accepts the loopback forms the emulators actually bind to", () => {
    expect(isLoopbackEmulatorHost("127.0.0.1:8080", 8080)).toBe(true);
    expect(isLoopbackEmulatorHost("localhost:8080", 8080)).toBe(true);
    expect(isLoopbackEmulatorHost("[::1]:8080", 8080)).toBe(true);
    expect(isLoopbackEmulatorHost("127.0.0.1:9099", 9099)).toBe(true);
    expect(isLoopbackEmulatorHost("localhost:9099", 9099)).toBe(true);
  });

  it("rejects remote IPs and arbitrary hostnames", () => {
    expect(isLoopbackEmulatorHost("10.0.0.5:8080", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("192.168.1.20:8080", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("firestore.example.com:8080", 8080)).toBe(
      false,
    );
    expect(isLoopbackEmulatorHost("evil.internal:9099", 9099)).toBe(false);
    // Not-quite-loopback lookalikes must not slip through.
    expect(isLoopbackEmulatorHost("127.0.0.1.evil.com:8080", 8080)).toBe(false);
  });

  it("rejects URLs with a scheme or path", () => {
    expect(isLoopbackEmulatorHost("http://127.0.0.1:8080", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("https://localhost:9099", 9099)).toBe(false);
    expect(isLoopbackEmulatorHost("127.0.0.1:8080/reset", 8080)).toBe(false);
  });

  it("rejects the wrong port", () => {
    expect(isLoopbackEmulatorHost("127.0.0.1:9090", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("localhost:9099", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("127.0.0.1:80", 8080)).toBe(false);
  });

  it("rejects missing host, missing port, and empty values", () => {
    expect(isLoopbackEmulatorHost(undefined, 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost("127.0.0.1", 8080)).toBe(false);
    expect(isLoopbackEmulatorHost(":8080", 8080)).toBe(false);
    // A bare (unbracketed) IPv6 loopback is not an accepted form.
    expect(isLoopbackEmulatorHost("::1:8080", 8080)).toBe(false);
  });
});

describe("isSafeEmulatorProject", () => {
  it("accepts demo- projects and the known E2E id", () => {
    expect(isSafeEmulatorProject("demo-anything")).toBe(true);
    expect(isSafeEmulatorProject(E2E_PROJECT_ID)).toBe(true);
  });

  it("rejects real-looking project ids and unset", () => {
    expect(isSafeEmulatorProject("saba-water-delivery")).toBe(false);
    expect(isSafeEmulatorProject(undefined)).toBe(false);
    expect(isSafeEmulatorProject("")).toBe(false);
  });
});

describe("assertEmulatorSafety", () => {
  const ORIGINAL_ENV = { ...process.env };

  function setSafeEnv(): void {
    delete process.env.VERCEL_ENV;
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_EMULATOR_PORT}`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_EMULATOR_PORT}`;
    process.env.FIREBASE_ADMIN_PROJECT_ID = E2E_PROJECT_ID;
  }

  beforeEach(() => {
    // Isolate from any ambient emulator/project variables.
    delete process.env.VERCEL_ENV;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_ADMIN_PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("passes for a valid local loopback emulator environment", () => {
    setSafeEnv();
    expect(() => assertEmulatorSafety()).not.toThrow();
  });

  it("passes with localhost loopback hosts", () => {
    setSafeEnv();
    process.env.FIRESTORE_EMULATOR_HOST = `localhost:${FIRESTORE_EMULATOR_PORT}`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `localhost:${AUTH_EMULATOR_PORT}`;
    expect(() => assertEmulatorSafety()).not.toThrow();
  });

  it("throws when the Firestore host is a remote address", () => {
    setSafeEnv();
    process.env.FIRESTORE_EMULATOR_HOST = "10.0.0.5:8080";
    expect(() => assertEmulatorSafety()).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it("throws when the Auth host is an arbitrary hostname", () => {
    setSafeEnv();
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth.example.com:9099";
    expect(() => assertEmulatorSafety()).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });

  it("throws when a host carries a URL scheme", () => {
    setSafeEnv();
    process.env.FIRESTORE_EMULATOR_HOST = "http://127.0.0.1:8080";
    expect(() => assertEmulatorSafety()).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it("throws when emulator hosts are unset", () => {
    process.env.FIREBASE_ADMIN_PROJECT_ID = E2E_PROJECT_ID;
    expect(() => assertEmulatorSafety()).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it("still rejects a non-demo project id", () => {
    setSafeEnv();
    process.env.FIREBASE_ADMIN_PROJECT_ID = "saba-water-delivery";
    expect(() => assertEmulatorSafety()).toThrow(/demo\/test project/);
  });

  it("still rejects a deployed Vercel environment", () => {
    setSafeEnv();
    process.env.VERCEL_ENV = "production";
    expect(() => assertEmulatorSafety()).toThrow(/deployed Vercel environment/);
  });
});
