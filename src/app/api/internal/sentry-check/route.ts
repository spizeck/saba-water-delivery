import { NextResponse } from "next/server";

import { resolveDeployment } from "@/lib/config/deployment";
import { withApiRoute } from "@/lib/http";
import { resolveSentryEnv } from "@/lib/monitoring/sentryShared";

/**
 * Synthetic Sentry verification endpoint (issue #115) — Preview/dev only.
 *
 * Exists so a Preview deployment can prove end-to-end error capture without
 * touching production: a GET throws a fixed, data-free error that travels the
 * real path (handler throw → `withApiRoute` → `captureServerError` → scrub →
 * Sentry). The 500 response carries the requestId, which the operator uses to
 * locate the event by its `requestId` tag.
 *
 * Production safety is structural: `VERCEL_ENV` is set by the platform and
 * cannot be influenced by the request, so in Production this route only ever
 * returns 404 — it can never throw.
 */
export const GET = withApiRoute("internal.sentry-check", async () => {
  if (resolveDeployment().target === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const sentry = resolveSentryEnv();
  if (!sentry.enabled) {
    return NextResponse.json({
      ok: false,
      reason: "sentry_not_configured",
      environment: sentry.environment,
    });
  }

  throw new Error(
    "Sentry synthetic verification error (non-production; contains no data)",
  );
});
