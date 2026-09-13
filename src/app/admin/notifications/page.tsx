import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import {
  getOutboxStateCounts,
  listNotificationsByState,
} from "@/lib/notifications/outboxAdmin";

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
  const [counts, failed] = await Promise.all([
    getOutboxStateCounts(),
    listNotificationsByState("failed", 100),
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
        </Container>
      </main>
    </>
  );
}
