import { describe, expect, it, vi } from "vitest";

import { getAppOrigin, getPwaInstallUrl, PWA_INSTALL_PATHS, PWA_PORTAL_PATHS } from "../constants";

describe("PWA constants", () => {
  it("returns the configured app origin when NEXT_PUBLIC_APP_URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://waterdelivery.saba.gov/");
    expect(getAppOrigin()).toBe("https://waterdelivery.saba.gov");
    vi.unstubAllEnvs();
  });

  it("falls back to the live pilot origin when NEXT_PUBLIC_APP_URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getAppOrigin()).toBe("https://saba-water-delivery.vercel.app");
    vi.unstubAllEnvs();
  });

  it("produces deterministic driver and resident install URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://waterdelivery.saba.gov");
    expect(getPwaInstallUrl("driver")).toBe("https://waterdelivery.saba.gov/driver/install");
    expect(getPwaInstallUrl("resident")).toBe("https://waterdelivery.saba.gov/resident/install");
    vi.unstubAllEnvs();
  });

  it("exposes stable install and portal paths", () => {
    expect(PWA_INSTALL_PATHS.driver).toBe("/driver/install");
    expect(PWA_INSTALL_PATHS.resident).toBe("/resident/install");
    expect(PWA_PORTAL_PATHS.driver).toBe("/driver");
    expect(PWA_PORTAL_PATHS.resident).toBe("/resident");
  });
});
