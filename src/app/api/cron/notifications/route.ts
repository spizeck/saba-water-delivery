import { NextResponse, type NextRequest } from "next/server";

import {
  getLogger,
  logSecurityEvent,
  SECURITY_EVENTS,
  serializeError,
} from "@/lib/logging";
import { withApiRoute } from "@/lib/http";
import { processNotificationOutbox } from "@/lib/notifications/worker";

const log = getLogger("api.cron.notifications");

/**
 * Durable notification outbox WORKER cron (issue #53).
 *
 * Drives one bounded pass of {@link processNotificationOutbox}: it claims,
 * sends, and records a limited number of due notifications. It is idempotent and
 * safe to invoke at any cadence — a notification is only sent once its
 * `nextAttemptAt` is due, and provider-level idempotency de-duplicates a retry
 * after a crash. The retry cadence is bounded by how often this route runs; see
 * `vercel.json` and docs/OPERATIONS.md (frequency depends on the Vercel plan).
 *
 * Protected by `CRON_SECRET`, exactly like the continuity-report cron: Vercel
 * Cron sends `Authorization: Bearer $CRON_SECRET`. An unauthenticated call is
 * rejected and logged as a security event, so the route is useless without the
 * secret. The response reports only AGGREGATE COUNTS — never notification
 * contents, recipients, or any PII.
 */
export const GET = withApiRoute(
  "cron.notifications",
  async (request: NextRequest) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error("notifications.outbox.cron_secret_missing");
      return NextResponse.json(
        { ok: false, error: "Service unavailable" },
        { status: 503 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logSecurityEvent(SECURITY_EVENTS.cronUnauthorized, {
        route: "cron.notifications",
      });
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const startedAt = Date.now();
    try {
      const result = await processNotificationOutbox();
      return NextResponse.json({
        ok: true,
        ...result,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log.error("notifications.outbox.cron_failed", {
        durationMs: Date.now() - startedAt,
        error: serializeError(err),
      });
      return NextResponse.json(
        { ok: false, error: "Notification worker failed." },
        { status: 500 },
      );
    }
  },
);
