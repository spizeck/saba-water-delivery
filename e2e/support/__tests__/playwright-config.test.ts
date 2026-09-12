import { describe, expect, it } from "vitest";

import playwrightConfig from "../../../playwright.config";

/**
 * Protects the production-safety property that the E2E suite always starts its
 * OWN emulator-configured app server and never attaches to a pre-existing one
 * (Aikido finding). A regression here (e.g. flipping `reuseExistingServer` back
 * to `true`) would let a routine `npm run test:e2e` silently drive an unrelated
 * `next dev`/`next start` that may be configured for real Firebase.
 */
describe("playwright webServer safety", () => {
  const webServer = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer[0]
    : playwrightConfig.webServer;

  it("never reuses a pre-existing server", () => {
    expect(webServer).toBeDefined();
    expect(webServer?.reuseExistingServer).toBe(false);
  });

  it("starts its own build and serves it in emulator mode", () => {
    expect(webServer?.command).toContain("npm run build");
    expect(webServer?.command).toContain("npm run start");
    // The server it starts is pointed at the local emulators, not real Firebase.
    const env = webServer?.env ?? {};
    expect(env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBe("127.0.0.1:9099");
  });
});
