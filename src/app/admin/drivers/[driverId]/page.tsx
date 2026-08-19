import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getFillStations } from "@/lib/domain/fillStations";
import {
  getDriver,
  getDriverEvents,
  getMeterAssignments,
} from "@/lib/domain/driverRegistry";
import { getResidentDirectory } from "@/lib/domain/users";

import { AccountLinkPanel } from "./AccountLinkPanel";
import { DriverEventHistory } from "./DriverEventHistory";
import { EditDriverForm } from "./EditDriverForm";
import { EligibilityPanel } from "./EligibilityPanel";
import { MeterAssignmentsPanel } from "./MeterAssignmentsPanel";

export const metadata: Metadata = {
  title: "Driver Detail — Admin",
};

interface PageProps {
  params: Promise<{ driverId: string }>;
}

export default async function DriverDetailPage({ params }: PageProps) {
  const { profile } = await requireRole("admin");
  const { driverId } = await params;

  const driver = await getDriver(driverId);

  if (!driver) {
    return (
      <>
        <PortalHeader portalName="Admin" roles={profile.roles} />
        <main className="flex-1 py-8">
          <Container>
            <Card>
              <p className="text-slate-600">Driver not found.</p>
              <Link href="/admin/drivers" className="mt-2 inline-block text-sm text-blue-700 hover:underline">
                Back to Driver Registry
              </Link>
            </Card>
          </Container>
        </main>
      </>
    );
  }

  const [stations, meters, events, residents] = await Promise.all([
    getFillStations(),
    getMeterAssignments(driverId),
    getDriverEvents(driverId),
    driver.linkedUserId ? Promise.resolve([]) : getResidentDirectory(),
  ]);

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-3xl">
          <div>
            <Link href="/admin/drivers" className="text-sm text-blue-700 hover:underline">
              &larr; Back to Driver Registry
            </Link>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">{driver.displayName}</h1>
          </div>

          <EditDriverForm driver={driver} />
          <AccountLinkPanel driver={driver} residents={residents} />
          <EligibilityPanel driver={driver} />
          <MeterAssignmentsPanel driverId={driverId} stations={stations} meters={meters} />
          <DriverEventHistory events={events} />
        </Container>
      </main>
    </>
  );
}
