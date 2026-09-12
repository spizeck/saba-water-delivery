import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http";

/**
 * Liveness probe (issue #33) — the cheapest possible "is the process/runtime
 * responding?" check.
 *
 * It has NO dependencies on purpose: no Firestore, no external APIs, no secrets.
 * It returns a constant `{ status: "ok" }` with 200 as long as the Next.js route
 * runtime can execute, so an outage in Firestore, Resend, or Meta must NEVER
 * make liveness fail — that distinction is what lets an operator tell "the app
 * is down" apart from "a dependency is degraded" (use `/api/readiness` for the
 * latter). Keep this handler dependency-free.
 *
 * Public-safe: the body is intentionally boring and exposes nothing about the
 * deployment, configuration, or infrastructure. The canonical `withApiRoute`
 * boundary adds the correlated `x-request-id` header and normalizes any
 * unexpected throw safely. `completionLogLevel: "debug"` keeps routine probes
 * from flooding production logs (which run at `LOG_LEVEL=info`); this endpoint
 * is expected to be polled frequently by uptime monitors.
 *
 * `force-dynamic` ensures the runtime actually executes on each request rather
 * than the route being statically optimized into a cached constant.
 */
export const dynamic = "force-dynamic";

export const GET = withApiRoute(
  "health",
  async () => NextResponse.json({ status: "ok" }),
  { completionLogLevel: "debug" },
);
