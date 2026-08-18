import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDrivers } from "@/lib/domain/drivers";
import type { WaterRequestStatus } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { getRequestEvents } from "@/lib/domain/waterRequests";
import { getAdminDb } from "@/lib/firebase/admin";

import { RequestActions } from "./RequestActions";

export const metadata: Metadata = {
  title: "Request Detail — Dispatcher",
};

const STATUS_LABELS: Record<WaterRequestStatus, string> = {
  requested: "Submitted",
  preferred_driver_hold: "Preferred driver hold",
  available: "Available",
  claimed: "Claimed",
  delivered: "Delivered",
  confirmed: "Confirmed",
  delivered_unconfirmed: "Unconfirmed",
  disputed: "DISPUTED",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<WaterRequestStatus, string> = {
  requested: "bg-blue-50 text-blue-800",
  preferred_driver_hold: "bg-amber-50 text-amber-800",
  available: "bg-blue-50 text-blue-800",
  claimed: "bg-indigo-50 text-indigo-800",
  delivered: "bg-green-50 text-green-800",
  confirmed: "bg-green-50 text-green-700",
  delivered_unconfirmed: "bg-amber-50 text-amber-800",
  disputed: "bg-red-100 text-red-900",
  cancelled: "bg-slate-100 text-slate-500",
};

const EVENT_LABELS: Record<string, string> = {
  request_created: "Request created",
  preferred_driver_selected: "Preferred driver selected",
  preferred_driver_expired: "Preferred driver hold expired",
  request_opened: "Opened to queue",
  driver_claimed: "Driver claimed",
  marked_delivered: "Marked delivered",
  customer_confirmed: "Customer confirmed",
  customer_disputed: "Customer disputed",
  delivery_confirmation_expired: "Confirmation window expired",
  dispute_resolved_completed: "Dispute resolved (completed)",
  dispute_resolved_reopened: "Dispute resolved (reopened)",
  request_cancelled: "Request cancelled",
  dispatcher_assigned: "Dispatcher assigned",
  dispatcher_reassigned: "Dispatcher reassigned",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface PageProps {
  params: Promise<{ requestId: string }>;
}

export default async function RequestDetailPage({ params }: PageProps) {
  const { profile } = await requireRole(["dispatcher", "admin"]);
  const { requestId } = await params;

  const db = getAdminDb();
  const requestDoc = await db.collection("waterRequests").doc(requestId).get();

  if (!requestDoc.exists) {
    return (
      <>
        <PortalHeader portalName="Dispatcher" roles={profile.roles} />
        <main className="flex-1 py-8">
          <Container>
            <Card>
              <p className="text-slate-600">Request not found.</p>
              <Link href="/dispatcher" className="mt-2 inline-block text-blue-700 hover:underline text-sm">
                Back to dashboard
              </Link>
            </Card>
          </Container>
        </main>
      </>
    );
  }

  const data = requestDoc.data()!;
  const status = data.status as WaterRequestStatus;

  // Fetch related data in parallel.
  const [customer, events, eligibleDrivers] = await Promise.all([
    getUserProfile(data.customerId),
    getRequestEvents(requestId),
    getAllDrivers(),
  ]);

  // Resolve driver names.
  const driverNames: Record<string, string> = {};
  for (const d of eligibleDrivers) {
    driverNames[d.uid] = d.displayName;
  }
  if (data.assignedDriverId && !driverNames[data.assignedDriverId]) {
    const p = await getUserProfile(data.assignedDriverId);
    if (p) driverNames[data.assignedDriverId] = p.displayName;
  }
  if (data.preferredDriverId && !driverNames[data.preferredDriverId]) {
    const p = await getUserProfile(data.preferredDriverId);
    if (p) driverNames[data.preferredDriverId] = p.displayName;
  }

  // Resolve actor names in events.
  const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[];
  const actorNames: Record<string, string> = { ...driverNames };
  if (customer) actorNames[customer.uid] = customer.displayName;
  await Promise.all(
    actorIds
      .filter((id) => !actorNames[id])
      .map(async (id) => {
        const p = await getUserProfile(id);
        if (p) actorNames[id] = p.displayName;
      }),
  );

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-5xl">
          <div>
            <Link href="/dispatcher" className="text-blue-700 hover:underline text-sm">
              &larr; Back to dashboard
            </Link>
          </div>

          {/* Request info */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-xl font-bold text-slate-900">Request detail</h1>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[status]}`}>
                {STATUS_LABELS[status]}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Customer</dt>
                <dd className="text-slate-900">{customer?.displayName ?? "Unknown"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Phone</dt>
                <dd className="text-slate-900">{customer?.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Village</dt>
                <dd className="text-slate-900">{data.village}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Delivery directions</dt>
                <dd className="text-slate-900">{data.deliveryDirections}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Requested</dt>
                <dd className="text-slate-900">
                  {data.requestedAt?.toDate ? formatDate(data.requestedAt.toDate().toISOString()) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Preferred driver</dt>
                <dd className="text-slate-900">
                  {data.preferredDriverId
                    ? driverNames[data.preferredDriverId] ?? data.preferredDriverId
                    : "None"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Assigned driver</dt>
                <dd className="text-slate-900">
                  {data.assignedDriverId
                    ? driverNames[data.assignedDriverId] ?? data.assignedDriverId
                    : "None"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Claimed</dt>
                <dd className="text-slate-900">
                  {data.claimedAt?.toDate ? formatDate(data.claimedAt.toDate().toISOString()) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Delivered</dt>
                <dd className="text-slate-900">
                  {data.deliveredAt?.toDate ? formatDate(data.deliveredAt.toDate().toISOString()) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Confirmed</dt>
                <dd className="text-slate-900">
                  {data.confirmedAt?.toDate ? formatDate(data.confirmedAt.toDate().toISOString()) : "—"}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Dispute reason — prominently displayed for disputed requests */}
          {status === "disputed" && (() => {
            const disputeEvent = events.find((e) => e.type === "customer_disputed");
            const reason = disputeEvent?.metadata?.reason as string | undefined;
            return (
              <Card className="!border-red-200 !bg-red-50">
                <h2 className="text-sm font-bold text-red-900">
                  Dispute Reason
                </h2>
                <p className="mt-1 text-sm text-red-800">
                  {reason || "No reason provided by resident."}
                </p>
                {disputeEvent && (
                  <p className="mt-2 text-xs text-red-600">
                    Disputed on {formatDate(disputeEvent.createdAt)}
                    {disputeEvent.actorId && (
                      <> by {actorNames[disputeEvent.actorId] ?? "Customer"}</>
                    )}
                  </p>
                )}
              </Card>
            );
          })()}

          {/* Actions */}
          <RequestActions
            requestId={requestId}
            status={status}
            eligibleDrivers={eligibleDrivers.filter((d) => d.eligibilityStatus === "eligible")}
          />

          {/* Event history */}
          <Card>
            <h2 className="text-lg font-bold text-slate-900">Event history</h2>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No events recorded.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {events.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {EVENT_LABELS[event.type] ?? event.type}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(event.createdAt)}
                        {event.actorId && (
                          <> &mdash; {actorNames[event.actorId] ?? event.actorId}</>
                        )}
                        {event.actorRole && (
                          <> ({event.actorRole})</>
                        )}
                      </p>
                      {event.metadata && Object.keys(event.metadata).length > 0 && (
                        <p className="mt-1 text-xs text-slate-600">
                          {Object.entries(event.metadata)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Container>
      </main>
    </>
  );
}
