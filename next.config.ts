import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  // pdfkit package. Needed by every route whose server bundle can
  // reach `renderContinuityReportPdf()`: the two dedicated API routes,
  // and `/dispatcher` (which imports the "Send Continuity Report Now"
  // server action from `src/app/dispatcher/actions.ts`).
  outputFileTracingIncludes: {
    "/api/cron/continuity-report": ["node_modules/pdfkit/js/data/**/*"],
    "/api/reports/continuity-snapshot": ["node_modules/pdfkit/js/data/**/*"],
    "/dispatcher": ["node_modules/pdfkit/js/data/**/*"],
  },
};

export default nextConfig;
