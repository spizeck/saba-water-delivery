import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows the local dev server's assets to be requested via 127.0.0.1 in
  // addition to localhost (e.g. from browser preview tooling).
  allowedDevOrigins: ["127.0.0.1"],

  // pdfkit loads its built-in font metrics (Helvetica.afm, etc.) with a
  // runtime `fs.readFileSync(path.join(__dirname, "data", ...))` call
  // rather than a static `import`/`require`, so Next's output file
  // tracing can't discover them automatically and they are missing
  // from the deployed Vercel function, causing
  // "ENOENT: ... open '.../data/Helvetica.afm'" in production even
  // though it works locally (see TECHNICAL.md "Operational Continuity
  // Snapshot"). Needed by every route whose server bundle can reach
  // `renderContinuityReportPdf()`: the two dedicated API routes, and
  // `/dispatcher` (which imports the "Send Continuity Report Now"
  // server action from `src/app/dispatcher/actions.ts`).
  outputFileTracingIncludes: {
    "/api/cron/continuity-report": ["node_modules/pdfkit/js/data/**/*"],
    "/api/reports/continuity-snapshot": ["node_modules/pdfkit/js/data/**/*"],
    "/dispatcher": ["node_modules/pdfkit/js/data/**/*"],
  },
};

export default nextConfig;
