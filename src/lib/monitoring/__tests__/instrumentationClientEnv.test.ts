import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the Production browser-init defect (issue #119).
 *
 * Why the existing unit tests missed it: every test of `resolveSentryEnv` /
 * `buildSentryInitOptions` injects an env OBJECT, so the code under test only
 * ever performs dynamic property reads (`env.NEXT_PUBLIC_*`). But Next.js
 * inlines `NEXT_PUBLIC_*` into the browser bundle by statically rewriting
 * literal `process.env.NAME` member expressions at build time — an indirect
 * read through a parameter is invisible to that transform. In the real
 * browser bundle `process.env` is a shim containing only the statically
 * referenced keys, so the DSN resolved to `undefined`, `enabled` was false,
 * `Sentry.init` never ran, and no `/sentry-tunnel` request was ever emitted.
 *
 * This test therefore asserts on the client ENTRY POINT's source: the values
 * the browser needs must appear as direct `process.env.NEXT_PUBLIC_*`
 * references inside `instrumentation-client.ts` itself, and the shared
 * builder must be invoked with that explicit env object rather than the
 * default `process.env` parameter. That is precisely what the bundler can
 * inline — a runtime assertion cannot prove it, because vitest never runs
 * the webpack DefinePlugin path.
 */
const clientEntrySource = readFileSync(
  join(process.cwd(), "src/instrumentation-client.ts"),
  "utf8",
);

describe("instrumentation-client environment boundary", () => {
  it.each([
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
    "NEXT_PUBLIC_SENTRY_RELEASE",
  ])(
    "references %s as a literal process.env member expression (inlinable)",
    (name) => {
      expect(clientEntrySource).toMatch(
        new RegExp(`process\\.env\\.${name}\\b`),
      );
    },
  );

  it("passes the explicit browser env object to the shared init builder", () => {
    // `buildSentryInitOptions("client")` with no env argument would fall back
    // to `process.env`, whose NEXT_PUBLIC_* reads inside sentryShared.ts are
    // dynamic and cannot be inlined into the browser bundle.
    expect(clientEntrySource).toMatch(
      /buildSentryInitOptions\(\s*"client",\s*\{/,
    );
  });

  it("does not pass the raw process.env object into the builder", () => {
    expect(clientEntrySource).not.toMatch(
      /buildSentryInitOptions\(\s*"client"\s*\)/,
    );
    expect(clientEntrySource).not.toMatch(/process\.env\s*\}/);
  });
});
