import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";
import type { WaterRequestStatus } from "@/lib/domain/types";
import { getAllRequests } from "@/lib/domain/waterRequests";
import { formatSabaDate } from "@/lib/utils/datetime";

export const metadata: Metadata = {
  title: "Viewer — Saba Water Delivery",
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

const OPEN_STATUSES: WaterRequestStatus[] = [
  "requested",
  "preferred_driver_hold",
  "available",
  "claimed",
  "delivered",
  "delivered_unconfirmed",
  "disputed",
];

/**
 * Read-only oversight portal. Deliberately shows only what's needed for
 * government oversight — no customer phone/email, no full delivery
 * directions, no access to the admin user directory. See PRODUCT.md /
 * TECHNICAL.md "Viewer Role" for the privacy rationale. Every projection
 * below is built server-side before anything is handed to JSX, so PII
 * never enters the rendered payload for this portal.
 */
export default async function ViewerPortalPage() {
  const { profile } = await requireRole("viewer");

  const [allRequests, allDrivers] = await Promise.all([
    getAllRequests(),
    getAllDriverRegistryEntries(),
  ]);

  const openRequests = allRequests
    .filter((r) => OPEN_STATUSES.includes(r.status))
    .sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

  // Reduced, oversight-appropriate projection — no phone/email/full
  // directions (see module doc above).
  const requestRows = openRequests.map((r) => ({
    id: r.id,
    status: r.status,
    village: r.village,
    source: r.source,
    requestedAt: r.requestedAt,
    hasAssignedDriver: Boolean(r.assignedDriverId),
  }));

  const driverRows = allDrivers.map((d) => ({
    id: d.id,
    displayName: d.displayName,
    eligibilityStatus: d.eligibilityStatus,
    availabilityStatus: d.availabilityStatus,
    accountLinked: Boolean(d.linkedUserId),
  }));

  return (
    <>
      <PortalHeader portalName="Viewer" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <Card className="!border-blue-200 !bg-blue-50">
            <p className="text-sm font-semibold text-blue-900">Read-Only</p>
            <p className="mt-1 text-sm text-blue-800">
              You have oversight access only. To manage requests or drivers,
              contact a dispatcher or administrator.
            </p>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900">
                Open Requests ({requestRows.length})
              </h1>
              <Link
                href="/statistics"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                View Statistics
              </Link>
            </div>

            {requestRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No open requests.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Village</th>
                      <th className="pb-2 pr-3">Requested</th>
                      <th className="pb-2 pr-3">Source</th>
                      <th className="pb-2">Driver Assigned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requestRows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 text-slate-900">{STATUS_LABELS[r.status]}</td>
                        <td className="py-2 pr-3 text-slate-600">{r.village}</td>
                        <td className="py-2 pr-3 text-slate-600">{formatSabaDate(r.requestedAt)}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {r.source === "dispatcher" ? "Staff" : "Online"}
                        </td>
                        <td className="py-2 text-slate-600">{r.hasAssignedDriver ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">
              Drivers ({driverRows.length})
            </h2>
            {driverRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No drivers in the registry.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Eligibility</th>
                      <th className="pb-2 pr-3">Availability</th>
                      <th className="pb-2">Account</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {driverRows.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-3 text-slate-900">{d.displayName}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {d.eligibilityStatus === "eligible" ? "Eligible" : "Ineligible"}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">
                          {d.availabilityStatus === "online" ? "Online" : "Offline"}
                        </td>
                        <td className="py-2 text-slate-600">{d.accountLinked ? "Linked" : "Not linked"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Container>
      </main>
    </>
  );
}
