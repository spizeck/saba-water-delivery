import type { Metadata } from "next";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Resident — Saba Water Delivery",
};

export default function ResidentPortalPage() {
  return (
    <>
      <PortalHeader portalName="Resident" />
      <main className="flex-1 py-8">
        <Container>
          <ComingSoon
            title="Request water"
            description="Residents will be able to request a standard 1,000-gallon delivery, optionally choose a preferred driver, and track request status here."
          />
        </Container>
      </main>
    </>
  );
}
