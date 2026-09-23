import { NextResponse, type NextRequest } from "next/server";

import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";
import { withApiRoute } from "@/lib/http";
import { processMergeAuthReconciliation } from "@/lib/domain/mergeReconciliation";
import { recordCronHeartbeat } from "@/lib/monitoring/cronHeartbeat";

const log = getLogger("api.cron.merge-auth-reconciliation");

/**
 * Account-merge Auth reconciliation sweep (issue #73).
 *
 * Drives one bounded pass of {@link processMergeAuthReconciliation}: it claims
 * unresolved `accountMergeEvents` (lease-guarded), performs the disable →
 * revoke → delete convergence for the merged-away Auth identity OUTSIDE any
 * transaction, and records the outcome. Idempotent and safe to invoke at any
 * cadence — work only runs once `nextAttemptAt` is due, expired leases are
 * reclaimed, and `auth/user-not-found` is an idempotent success. The retry
 * cadence is bounded by how often this route runs; see `vercel.json` and
 * docs/OPERATIONS.md.
 *
 * Protected by `CRON_SECRET`, exactly like the other cron routes. An
 * unauthenticated call is rejected and logged as a security event. The
 * response reports only AGGREGATE COUNTS — never uids or provider errors.
 */
export const GET = withApiRoute(
  "cron.merge-auth-reconciliation",
  async (request: NextRequest) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error("merge.auth_reconciliation.cron_secret_missing");
      return NextResponse.json(
        { ok: false, error: "Service unavailable" },
        { status: 503 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logSecurityEvent(SECURITY_EVENTS.cronUnauthorized, {
        route: "cron.merge-auth-reconciliation",
      });
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const startedAt = Date.now();
    try {
      const result = await processMergeAuthReconciliation();
      await recordCronHeartbeat("merge-auth-reconciliation", "success");
      return NextResponse.json({
        ok: true,
        ...result,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log.error("merge.auth_reconciliation.cron_failed", {
        durationMs: Date.now() - startedAt,
        error: serializeError(err),
      });
      await recordCronHeartbeat("merge-auth-reconciliation", "failure");
      return NextResponse.json(
        { ok: false, error: "Reconciliation worker failed." },
        { status: 500 },
      );
    }
  },
);
