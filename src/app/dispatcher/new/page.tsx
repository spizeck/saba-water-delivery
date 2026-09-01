import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getEligibleDriverOptions } from "@/lib/domain/driverRegistry";
import { getResidentDirectory } from "@/lib/domain/users";
import { getActiveCustomerIds } from "@/lib/domain/waterRequests";

import { CreateRequestForm } from "./CreateRequestForm";

export const metadata: Metadata = {
  title: "Create Water Request — Dispatcher",
};

export default async function CreateWaterRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { profile } = await requireRole(["dispatcher", "admin"]);
  const { fresh } = await searchParams;

  const [residents, eligibleDrivers, activeCustomerIds] = await Promise.all([
    getResidentDirectory(),
    getEligibleDriverOptions(),
    getActiveCustomerIds(),
  ]);

  return (
    <>
      <PortalHeader portalName="Dispatcher" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-2xl">
          <div>
            <Link href="/dispatcher" className="text-blue-700 hover:underline text-sm">
              &larr; Back to dashboard
            </Link>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">Create Water Request</h1>
            <p className="mt-1 text-sm text-slate-600">
              For a resident who called or visited the office. This enters the
              same delivery workflow as an online request.
            </p>
          </div>

          <CreateRequestForm
            key={fresh ?? "initial"}
            residents={residents}
            eligibleDrivers={eligibleDrivers}
            residentsWithActiveRequest={Array.from(activeCustomerIds)}
          />
        </Container>
      </main>
    </>
  );
}
