import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllDriverRegistryEntries } from "@/lib/domain/driverRegistry";

import { DriverRegistryList } from "./DriverRegistryList";
import { NewDriverForm } from "./NewDriverForm";
import { RegistryTools } from "./RegistryTools";

export const metadata: Metadata = {
  title: "Driver Registry — Admin",
};

export default async function DriverRegistryPage() {
  const { profile } = await requireRole("admin");
  const drivers = await getAllDriverRegistryEntries();

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <div>
            <Link href="/admin" className="text-sm text-blue-700 hover:underline">
              &larr; Back to admin
            </Link>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">Driver Registry</h1>
            <p className="mt-1 text-sm text-slate-600">
              Government-managed roster of water delivery drivers. A driver
              can exist here before they ever create an application account.
            </p>
          </div>

          <NewDriverForm />
          <DriverRegistryList drivers={drivers} />
          <RegistryTools />
        </Container>
      </main>
    </>
  );
}
