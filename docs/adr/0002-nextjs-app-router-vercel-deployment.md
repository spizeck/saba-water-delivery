# 0002. Next.js App Router + TypeScript on Vercel (webpack build)

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-17, the
  initial commit; records an existing decision)

## Context

The application is a single web app serving residents, drivers, and staff, plus
a WhatsApp webhook and a nightly cron. It needs server-rendered, authorization-
gated pages; server-side data access with the Firebase Admin SDK; and simple,
low-maintenance hosting for a government handover.

## Decision

- Build with **Next.js 16 (App Router)** and **TypeScript**, using React Server
  Components by default and Client Components only where interactivity is needed.
  The server/client boundary is a first-class part of the design (Admin SDK and
  secrets live server-only; see [0003](./0003-server-authoritative-mutation-model.md)
  and TECHNICAL.md "Server vs Client").
- Deploy on **Vercel** via its Git integration (Preview per PR, Production on
  `main`). The WhatsApp webhook and the continuity cron run as part of the same
  deployment (`vercel.json` schedules the cron).
- **Build with webpack, not Turbopack** (`next build --webpack` / `next dev
  --webpack`), because PDFKit's transitive `fontkit` dependency cannot currently
  be bundled by Turbopack, and a `postbuild` step verifies PDFKit's font/color
  asset trace is present in the server bundle.

## Alternatives considered

- **Turbopack** (the Next.js 16 default): faster, but currently cannot bundle
  `fontkit` for the continuity-report PDF. Pinned to webpack until that is
  resolved upstream. This is an implementation constraint, **not** a permanent
  architectural commitment — webpack may be dropped once Turbopack supports the
  PDF path and the trace check still passes.
- **A separate backend service / container host:** more moving parts to secure
  and operate than a single Vercel deployment; not warranted at this scale.
- **Static export:** impossible — the app is authorization-gated and dynamic.

## Consequences

- One deployment hosts the site, webhook, and cron together; a Vercel outage
  takes all of them down together (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)).
- The webpack pin is load-bearing for PDF generation; the `postbuild` PDFKit
  trace check (`scripts/verify-pdfkit-trace.mjs`) fails the build if the packaging
  regresses. Do not remove `--webpack` without confirming the build and that
  check still pass.
- Environment configuration is not in Git and must be recovered separately
  ([0014](./0014-backup-and-disaster-recovery-strategy.md) §Environment).

## Operational implications

- Vercel Production/Preview environment variables are the authoritative copy of
  runtime config (see [`../DEPLOYMENT.md`](../DEPLOYMENT.md)).
- Node version is pinned via `.nvmrc` (Node 24) to match the Vercel runtime.
- Do not change Vercel production settings casually; recovery and env-var
  ownership belong to the government project owners.

## References

- [`package.json`](../../package.json) (`build`/`dev` use `--webpack`; `postbuild`
  runs the trace check), [`next.config.ts`](../../next.config.ts)
- [`scripts/verify-pdfkit-trace.mjs`](../../scripts/verify-pdfkit-trace.mjs)
- [`vercel.json`](../../vercel.json), [`.nvmrc`](../../.nvmrc)
- TECHNICAL.md "Progressive Web App and pilot deployment", "PDFKit / Vercel
  deployment"; [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
