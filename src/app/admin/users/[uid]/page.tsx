import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getDriverEvents, getRoleEvents } from "@/lib/domain/admin";
import { getDriverProfile } from "@/lib/domain/drivers";
import { getUserProfile } from "@/lib/domain/users";
import { getActiveDeliveryCount } from "@/lib/domain/admin";

import { DriverEligibilitySection } from "./DriverEligibilitySection";
import { RoleManagement } from "./RoleManagement";
import { UserHistory } from "./UserHistory";

export const metadata: Metadata = {
  title: "User Detail — Admin",
};

interface PageProps {
  params: Promise<{ uid: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { profile: adminProfile, uid: adminUid } = await requireRole("admin");
  const { uid } = await params;

  const targetUser = await getUserProfile(uid);

  if (!targetUser) {
    return (
      <>
        <PortalHeader portalName="Admin" roles={adminProfile.roles} />
        <main className="flex-1 py-8">
          <Container>
            <Card>
              <p className="text-slate-600">User not found.</p>
              <Link
                href="/admin"
                className="mt-2 inline-block text-sm text-blue-700 hover:underline"
              >
                Back to users
              </Link>
            </Card>
          </Container>
        </main>
      </>
    );
  }

  const isDriver = targetUser.roles.includes("driver");

  // Fetch driver profile and events in parallel if user is a driver.
  const [driverProfile, roleEvents, driverEvents, activeDeliveries] =
    await Promise.all([
      isDriver ? getDriverProfile(uid) : null,
      getRoleEvents(uid),
      isDriver ? getDriverEvents(uid) : [],
      isDriver ? getActiveDeliveryCount(uid) : 0,
    ]);

  // Resolve actor names for events.
  const actorIds = [
    ...new Set([
      ...roleEvents.map((e) => e.actorId),
      ...driverEvents.map((e) => e.actorId).filter(Boolean),
    ]),
  ] as string[];
  const actorNames: Record<string, string> = {};
  await Promise.all(
    actorIds.map(async (id) => {
      const p = await getUserProfile(id);
      if (p) actorNames[id] = p.displayName;
    }),
  );

  return (
    <>
      <PortalHeader portalName="Admin" roles={adminProfile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div>
            <Link
              href="/admin"
              className="text-sm text-blue-700 hover:underline"
            >
              &larr; Back to users
            </Link>
          </div>

          {/* User info */}
          <Card>
            <h1 className="text-xl font-bold text-slate-900">
              {targetUser.displayName || "Unnamed user"}
            </h1>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Email</dt>
                <dd className="text-slate-900">
                  {targetUser.email ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Phone</dt>
                <dd className="text-slate-900">
                  {targetUser.phone ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Village</dt>
                <dd className="text-slate-900">
                  {targetUser.village ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Member since</dt>
                <dd className="text-slate-900">
                  {new Date(targetUser.createdAt).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Role management */}
          <RoleManagement
            targetUid={uid}
            currentRoles={targetUser.roles}
            isOwnAccount={uid === adminUid}
            activeDeliveries={activeDeliveries}
          />

          {/* Driver eligibility section (only for users with driver role) */}
          {isDriver && driverProfile && (
            <DriverEligibilitySection
              driverId={uid}
              driverProfile={driverProfile}
            />
          )}

          {/* History */}
          <UserHistory
            roleEvents={roleEvents}
            driverEvents={driverEvents}
            actorNames={actorNames}
            isDriver={isDriver}
          />
        </Container>
      </main>
    </>
  );
}
