import { NextResponse } from "next/server";

import { evaluateReadiness } from "@/lib/health";
import { withApiRoute } from "@/lib/http";

/**
 * Readiness probe (issue #33) — "can the app perform its core water-delivery
 * service right now?"
 *
 * Readiness reflects Firebase Admin / Firestore connectivity only; optional,
 * gracefully-degrading integrations do not influence it (see
 * `@/lib/health/readiness` and TECHNICAL.md "Health and readiness endpoints").
 * A ready app returns 200; a Firestore-unavailable app returns 503 so a
 * deployment/monitoring system can distinguish a healthy-but-not-ready state
 * from a plain liveness failure. 503 (not 500) is used for a known
 * dependency-unavailable condition.
 *
 * The response is a stable, categorical shape — `{ status, checks }` with only
 * `"ok"`/`"unavailable"`/`"ready"`/`"not_ready"` values — and never carries a
 * reason, provider error, exception message, stack trace, secret, project id,
 * service-account detail, or Firestore path. The evaluation catches its own
 * failures and logs them (sanitized) via the structured logger, so the only
 * throw `withApiRoute` would normalize here is a genuinely unexpected one.
 *
 * `completionLogLevel: "debug"` keeps routine successful probes from flooding
 * production logs; a readiness FAILURE is still logged loudly (at error) inside
 * `evaluateReadiness` as `health.readiness.failed`. `force-dynamic` guarantees
 * the probe runs on every request instead of being statically cached.
 */
export const dynamic = "force-dynamic";

export const GET = withApiRoute(
  "readiness",
  async () => {
    const result = await evaluateReadiness();
    return NextResponse.json(
      { status: result.status, checks: result.checks },
      { status: result.httpStatus },
    );
  },
  { completionLogLevel: "debug" },
);
