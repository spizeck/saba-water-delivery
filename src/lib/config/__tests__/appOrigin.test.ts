import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_ORIGIN,
  appOriginStatus,
  getAppOrigin,
} from "../appOrigin";

/**
 * Canonical app-origin resolution (issue #54). Confirms the single source of
 * truth normalizes consistently (fixing the previous trailing-slash divergence)
 * and never throws at the build-time boundary.
 */

describe("getAppOrigin", () => {
  it("falls back to the documented pilot origin when unset", () => {
    expect(getAppOrigin({})).toBe(DEFAULT_APP_ORIGIN);
    expect(getAppOrigin({ NEXT_PUBLIC_APP_URL: "   " })).toBe(
      DEFAULT_APP_ORIGIN,
    );
  });

  it("normalizes a configured URL to its origin (no trailing slash, no path)", () => {
    expect(
      getAppOrigin({ NEXT_PUBLIC_APP_URL: "https://water.gov.example/" }),
    ).toBe("https://water.gov.example");
    expect(
      getAppOrigin({ NEXT_PUBLIC_APP_URL: "https://water.gov.example/app/x" }),
    ).toBe("https://water.gov.example");
  });

  it("falls back (never throws) when the configured URL is malformed", () => {
    expect(getAppOrigin({ NEXT_PUBLIC_APP_URL: "not a url" })).toBe(
      DEFAULT_APP_ORIGIN,
    );
  });
});

describe("appOriginStatus", () => {
  it("reports unset / set / invalid", () => {
    expect(appOriginStatus({})).toBe("unset");
    expect(appOriginStatus({ NEXT_PUBLIC_APP_URL: "https://x.example" })).toBe(
      "set",
    );
    expect(appOriginStatus({ NEXT_PUBLIC_APP_URL: "ftp://x.example" })).toBe(
      "invalid",
    );
  });
});
