import type { Metadata } from "next";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Driver — Saba Water Delivery",
};

export default async function DriverPortalPage() {
  await requireRole("driver");

  return (
    <>
      <PortalHeader portalName="Driver" />
      <main className="flex-1 py-8">
        <Container>
          <ComingSoon
            title="Available deliveries"
            description="Drivers will be able to go online, view eligible open requests oldest-first, claim a delivery, and mark it delivered here."
          />
        </Container>
      </main>
    </>
  );
}
