import { describe, expect, it } from "vitest";

import PrivacyPage from "../page";

/**
 * The Privacy Policy is the public disclosure surface: if the Sentry /
 * error-monitoring wording is ever removed or weakened accidentally, this
 * test fails. It asserts disclosure CATEGORIES exist — not exact prose.
 */

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props?.children !== undefined) collectText(props.children, out);
  }
  return out;
}

describe("privacy page", () => {
  const text = collectText(PrivacyPage()).join(" ");

  it("discloses Sentry as a technical error-monitoring service", () => {
    expect(text).toContain("Sentry");
    expect(text).toMatch(/error[- ]monitoring/i);
  });

  it("explains that unexpected errors send limited diagnostic information", () => {
    expect(text).toMatch(/unexpected.*error/i);
    expect(text).toMatch(/limited technical diagnostic information/i);
  });

  it("discloses the application's exclusion of personal data categories", () => {
    expect(text).toMatch(/configured to exclude/i);
    for (const category of [
      "names",
      "email addresses",
      "phone numbers",
      "addresses and directions",
      "cookies",
      "request bodies",
      "secrets",
    ]) {
      expect(text.toLowerCase()).toContain(category);
    }
  });

  it("distinguishes error monitoring from analytics/advertising", () => {
    expect(text).toMatch(
      /never for advertising, tracking, behavioral profiling, or product analytics/i,
    );
    expect(text).toContain("reliability");
  });

  it("discloses the active third-party providers", () => {
    for (const provider of ["Firebase", "Vercel", "Resend", "Sentry"]) {
      expect(text).toContain(provider);
    }
  });

  it("contains no secrets or configuration values", () => {
    expect(text).not.toMatch(/sentry\.io\/|o\d+\.ingest|SENTRY_[A-Z_]+/);
  });
});
