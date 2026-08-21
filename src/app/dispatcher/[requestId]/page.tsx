import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDriverRegistryEntries, getEligibleDriverOptions } from "@/lib/domain/driverRegistry";
import type { DispatchPriority, WaterRequestStatus } from "@/lib/domain/types";
import { getUserProfile } from "@/lib/domain/users";
import { checkDeliveryConfirmationTimeout, getRequestEvents } from "@/lib/domain/waterRequests";
import { getAdminDb } from "@/lib/firebase/admin";
import { formatSabaDateTime } from "@/lib/utils/datetime";

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
  disputed: "bg-red-100 text-red-900",
  cancelled: "bg-slate-100 text-slate-500",
};

const EVENT_LABELS: Record<string, string> = {
  request_created: "Request created",
  request_created_by_dispatcher: "Request created by staff",
  preferred_driver_selected: "Preferred driver selected",
  preferred_driver_expired: "Preferred driver hold expired",
  preferred_driver_declined: "Preferred driver declined",
  request_opened: "Opened to queue",
  driver_claimed: "Driver claimed",
  marked_delivered: "Marked delivered",
  customer_confirmed: "Customer confirmed",
  delivery_confirmed_by_dispatcher: "Delivery confirmed by staff",
  customer_disputed: "Customer disputed",
  delivery_auto_confirmed: "Automatically confirmed (no response within window)",
  dispute_resolved_completed: "Dispute resolved (completed)",
  dispute_resolved_reopened: "Dispute resolved (reopened)",
  request_cancelled: "Request cancelled",
  dispatcher_assigned: "Dispatcher assigned",
  dispatcher_reassigned: "Dispatcher reassigned",
  request_priority_changed: "Priority changed",
  preferred_driver_bypassed_for_priority: "Preferred driver bypassed (priority)",
  preferred_driver_hold_released_for_priority: "Preferred driver hold released (priority)",
};

const PRIORITY_LABELS: Record<string, string> = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
};

const PRIORITY_COLORS: Record<string, string> = {
  normal: "bg-slate-100 text-slate-600",
  urgent: "bg-amber-50 text-amber-800",
  critical: "bg-red-100 text-red-900",
};

const VULNERABLE_LABELS: Record<string, string> = {
  elderly: "Elderly person",
  infant_or_young_child: "Infant or young child",
  medical_need: "Medical need",
  essential_services_commercial_business: "Essential services (Commercial/business)",
  hotel_or_restaurant: "Hotel or Restaurant",
  none: "None",
};

const formatDate = formatSabaDateTime;

interface PageProps {
  params: Promise<{ requestId: string }>;
}

export default async function RequestDetailPage({ params }: PageProps) {
  const { profile } = await requireRole(["dispatcher", "admin"]);
  const { requestId } = await params;

  const db = getAdminDb();
  let requestDoc = await db.collection("waterRequests").doc(requestId).get();

  // Lazily auto-confirm if this "delivered" request's confirmation
  // window has already expired — see PRODUCT.md "Delivery Confirmation".
  if (requestDoc.exists && requestDoc.data()!.status === "delivered") {
    await checkDeliveryConfirmationTimeout(requestId);
    requestDoc = await db.collection("waterRequests").doc(requestId).get();
  }

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
  const isRegisteredCustomer = Boolean(data.customerId);

  // Fetch related data in parallel. Prefer the request's own customer
  // snapshot; only fall back to a live profile lookup for legacy requests
  // that predate the snapshot field (and never for unregistered customers,
  // who have no `users/{uid}` document to look up).
  const [legacyCustomerProfile, events, allDriverEntries, eligibleDriverOptions] =
    await Promise.all([
      !data.customer && data.customerId ? getUserProfile(data.customerId) : null,
      getRequestEvents(requestId),
      getAllDriverRegistryEntries(),
      getEligibleDriverOptions(),
    ]);

  const customer = data.customer
    ? { displayName: data.customer.displayName, phone: data.customer.phone ?? null }
    : legacyCustomerProfile
      ? { displayName: legacyCustomerProfile.displayName, phone: legacyCustomerProfile.phone }
      : null;

  // Resolve driver names (keyed by uid, since assignedDriverId/
  // preferredDriverId store the linked account's uid — see
  // TECHNICAL.md "Driver Registry").
  const driverNames: Record<string, string> = {};
  for (const d of allDriverEntries) {
    if (d.linkedUserId) driverNames[d.linkedUserId] = d.displayName;
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
  if (customer && data.customerId) actorNames[data.customerId] = customer.displayName;
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
              <div className="flex flex-col items-end gap-1">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[status]}`}>
                  {STATUS_LABELS[status]}
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    PRIORITY_COLORS[data.dispatchPriority ?? "normal"]
                  }`}
                >
                  {PRIORITY_LABELS[data.dispatchPriority ?? "normal"]} priority
                </span>
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {data.source === "dispatcher" ? "Entered by staff" : "Submitted online"}
                </span>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Customer</dt>
                <dd className="text-slate-900">
                  {customer?.displayName ?? "Unknown"}
                  {!isRegisteredCustomer && (
                    <span className="ml-1.5 inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      unregistered
                    </span>
                  )}
                </dd>
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

          {/* Water situation — operational context for priority review.
              Staff need this to assess urgency; drivers never see it
              (see PRODUCT.md "Privacy"). */}
          {data.waterSituation && (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">Water Situation</h2>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-500">Resident-reported urgency</dt>
                  <dd className="text-slate-900 capitalize">
                    {data.waterSituation.reportedUrgency ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Persons affected</dt>
                  <dd className="text-slate-900">
                    {data.waterSituation.personsAffected ?? "Not provided"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-500">Available storage</dt>
                  <dd className="text-slate-900">
                    {data.waterSituation.availableStorageCapacity ?? "Not provided"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-500">
                    Vulnerable / critical circumstances
                  </dt>
                  <dd className="text-slate-900">
                    {((data.waterSituation.vulnerableCircumstances as string[]) ?? ["none"])
                      .map((c) => VULNERABLE_LABELS[c] ?? c)
                      .join(", ")}
                  </dd>
                </div>
                {data.waterSituation.reportedUrgency === "critical" && (
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-slate-500">Critical explanation</dt>
                    <dd className="text-slate-900">
                      {data.waterSituation.criticalExplanation ?? "Not provided"}
                    </dd>
                  </div>
                )}
              </dl>
              {data.priorityReason && (
                <p className="mt-3 text-xs text-slate-500">
                  Priority reason: {data.priorityReason}
                  {data.prioritySource === "dispatcher" && " (staff override)"}
                </p>
              )}
            </Card>
          )}

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
            eligibleDrivers={eligibleDriverOptions}
            canConfirmUnregisteredDelivery={!isRegisteredCustomer && status === "delivered"}
            currentPriority={(data.dispatchPriority as DispatchPriority) ?? "normal"}
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
