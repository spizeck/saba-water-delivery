import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/lib/security/headers";

// Source maps upload only on Production builds (Sentry is production-only by
// policy — Preview creates no releases or artifacts). A Production build
// without SENTRY_AUTH_TOKEN still succeeds and serves errors, just
// unsymbolicated.
const sentryUploadEnabled =
  process.env.VERCEL_ENV === "production" &&
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) &&
  Boolean(process.env.SENTRY_AUTH_TOKEN);

// pdfkit v0.20+ ships its Base-14 font metrics as dynamically required
// `./standard-fonts/*.cjs` modules (plus a shared `chunks` file), while
// the ICC color profile and legacy AFM files remain under `./data/`.
// These assets are read at runtime, not statically imported, so Next's
// output tracing must copy both trees for every server bundle that can
// reach a PDFKit renderer.
const PDFKIT_TRACE = [
  "node_modules/pdfkit/js/data/**/*",
  "node_modules/pdfkit/js/standard-fonts/**/*",
];

const nextConfig: NextConfig = {
  env: {
    // VERCEL_ENV / VERCEL_GIT_COMMIT_SHA are server-only at runtime; inline
    // them so the browser-side Sentry init can tag environment + release.
    // Both are non-secret categorical metadata.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },

  async headers() {
    return [
      {
        // Canonical browser security headers (CSP, COOP, Referrer-Policy,
        // X-Content-Type-Options, X-Frame-Options, Permissions-Policy, HSTS).
        // Single source of truth: src/lib/security/headers.ts.
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
      {
        source: "/driver-manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
      {
        source: "/resident-manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
    ];
  },

  // Allows the local dev server's assets to be requested via 127.0.0.1 in
  // addition to localhost (e.g. from browser preview tooling).
  allowedDevOrigins: ["127.0.0.1"],

  // pdfkit resolves its built-in font metrics (Helvetica.afm, etc.) at
  // runtime using a path relative to its own `__dirname`
  // (path.join(__dirname, "data", "Helvetica.afm")). When Next bundles
  // pdfkit's code INTO a webpack chunk (e.g.
  // `.next/server/chunks/9.js`), `__dirname` at runtime resolves to
  // that chunks directory, not pdfkit's real package directory — so
  // pdfkit looks for `.next/server/chunks/data/Helvetica.afm`, which
  // never exists, regardless of what outputFileTracingIncludes copies
  // under `node_modules/pdfkit/js/data/`. Excluding pdfkit from
  // Server Components/Route Handler bundling keeps it a real,
  // unbundled `require("pdfkit")` at runtime, so its own `__dirname`
  // stays the actual package directory and its relative data lookup
  // resolves correctly. See TECHNICAL.md "Operational Continuity
  // Snapshot".
  serverExternalPackages: ["pdfkit"],

  // outputFileTracingIncludes is still required alongside
  // serverExternalPackages above: pdfkit's font-metric files are read
  // via a runtime `fs.readFileSync`, not a static `import`/`require`,
  // so Next's automatic trace of the (now-external) `require("pdfkit")`
  // call still cannot discover them on its own — they must be listed
  // explicitly so Vercel copies them alongside the now-unbundled
  // pdfkit package. PDFKIT_TRACE includes both the `./data/` and
  // `./standard-fonts/` trees required by pdfkit v0.20+.
  outputFileTracingIncludes: {
    // Continuity report cron/email.
    "/api/cron/continuity-report": PDFKIT_TRACE,
    // Manual continuity report download.
    "/api/reports/continuity-snapshot": PDFKIT_TRACE,
    // "Send Continuity Report Now" server action lives on `/dispatcher`.
    "/dispatcher": PDFKIT_TRACE,
    // Delivery Run driver run sheet. The dynamic segment is escaped
    // because outputFileTracingIncludes keys are matched with picomatch,
    // which would otherwise treat `[batchId]` as a character class
    // rather than a literal route segment (see Next.js docs "output"
    // config reference, `/api/login/\\[\\[\\.\\.\\.slug\\]\\]` example).
    "/api/dispatcher/batches/\\[batchId\\]/pdf": PDFKIT_TRACE,
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Client events POST to this same-origin route which the SDK forwards to
  // Sentry — avoids ad-blocker drops and requires no CSP connect-src change.
  tunnelRoute: "/sentry-tunnel",
  widenClientFileUpload: true,
  useRunAfterProductionCompileHook: true,
  sourcemaps: {
    disable: !sentryUploadEnabled,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    autoInstrumentAppDirectory: true,
    autoInstrumentServerFunctions: true,
  },
});
