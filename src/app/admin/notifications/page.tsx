import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getCronHeartbeatStatuses } from "@/lib/monitoring/cronHeartbeat";
import {
  getOutboxStateCounts,
  listNotificationsByState,
} from "@/lib/notifications/outboxAdmin";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import { NotificationOutboxList } from "./NotificationOutboxList";

export const metadata: Metadata = {
  title: "Notifications — Saba Water Delivery",
};

/**
 * Admin-only operator view of the durable notification outbox (issue #53):
 * per-state counts plus the actionable list of terminally-failed notifications
 * with a safe manual retry. Sanitized — opaque ids and state only.
 */
export default async function AdminNotificationsPage() {
  const { profile } = await requireRole("admin");
  const [counts, failed, heartbeats] = await Promise.all([
    getOutboxStateCounts(),
    listNotificationsByState("failed", 100),
    getCronHeartbeatStatuses(),
  ]);

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-5xl">
          <Card>
            <h1 className="text-2xl font-bold text-slate-900">
              Notification outbox
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Important transactional notifications (delivery-confirmation
              email) are delivered from a durable outbox and retried
              automatically after transient provider failures. This view lists
              notifications that have permanently failed and lets an
              administrator re-queue one after the underlying issue is resolved.
            </p>
            <dl className="mt-4 flex flex-wrap gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Pending</dt>
                <dd className="font-semibold text-slate-900">
                  {counts.pending}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Processing</dt>
                <dd className="font-semibold text-slate-900">
                  {counts.processing}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Sent</dt>
                <dd className="font-semibold text-slate-900">{counts.sent}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Failed</dt>
                <dd className="font-semibold text-slate-900">
                  {counts.failed}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">
              Failed notifications
            </h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              Retrying re-queues the notification with a fresh attempt budget; a
              notification already marked sent is never resent.
            </p>
            <NotificationOutboxList failed={failed} />
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">
              Scheduled jobs
            </h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              Each scheduled job records a heartbeat on every run. A job shown
              as <span className="font-medium">stale</span> has not succeeded
              within its expected window — check Vercel Cron and the structured
              logs. See OPERATIONS.md &quot;Production monitoring and
              alerting&quot;.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="pb-2 font-medium">Job</th>
                  <th className="pb-2 font-medium">Schedule</th>
                  <th className="pb-2 font-medium">Last success</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {heartbeats.map((hb) => (
                  <tr
                    key={hb.cron}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {hb.label}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{hb.schedule}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {hb.lastSuccessAt
                        ? formatSabaDateTime(hb.lastSuccessAt)
                        : "never recorded"}
                    </td>
                    <td className="py-2">
                      {hb.stale ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                          Stale
                        </span>
                      ) : hb.consecutiveFailures > 0 ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Failing ({hb.consecutiveFailures})
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Fresh
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Container>
      </main>
    </>
  );
}
