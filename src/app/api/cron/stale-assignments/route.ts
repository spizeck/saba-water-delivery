import { NextResponse, type NextRequest } from "next/server";

import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";
import { withApiRoute } from "@/lib/http";
import { releaseStaleAssignments } from "@/lib/domain/staleAssignments";
import { recordCronHeartbeat } from "@/lib/monitoring/cronHeartbeat";

const log = getLogger("api.cron.stale-assignments");

/**
 * Stale-assignment sweep (issue #135).
 *
 * Drives one bounded pass of {@link releaseStaleAssignments}: ordinary
 * `claimed` requests whose CURRENT assignment (`claimedAt`) is older than
 * `appConfig.staleAssignmentReleaseHours` (12h) are released back to
 * dispatch, each inside its own transaction that re-validates committed
 * state — so a missed run is caught up by the next one, and overlapping
 * or repeated runs are idempotent no-ops.
 *
 * Protected by `CRON_SECRET`, exactly like the other cron routes. An
 * unauthenticated call is rejected and logged as a security event. The
 * response reports only AGGREGATE COUNTS — never request IDs or uids.
 */
export const GET = withApiRoute(
  "cron.stale-assignments",
  async (request: NextRequest) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error("dispatch.stale_assignments.cron_secret_missing");
      return NextResponse.json(
        { ok: false, error: "Service unavailable" },
        { status: 503 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logSecurityEvent(SECURITY_EVENTS.cronUnauthorized, {
        route: "cron.stale-assignments",
      });
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const startedAt = Date.now();
    try {
      const result = await releaseStaleAssignments();
      await recordCronHeartbeat(
        "stale-assignments",
        result.failed > 0 ? "failure" : "success",
      );
      return NextResponse.json({
        ok: true,
        ...result,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log.error("dispatch.stale_assignments.cron_failed", {
        durationMs: Date.now() - startedAt,
        error: serializeError(err),
      });
      await recordCronHeartbeat("stale-assignments", "failure");
      return NextResponse.json(
        { ok: false, error: "Stale-assignment sweep failed." },
        { status: 500 },
      );
    }
  },
);
