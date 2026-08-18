import type { Metadata } from "next";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Admin — Saba Water Delivery",
};

export default function AdminPortalPage() {
  return (
    <>
      <PortalHeader portalName="Admin" />
      <main className="flex-1 py-8">
        <Container>
          <ComingSoon
            title="System administration"
            description="Administrators will manage drivers, suspend/reactivate drivers, manage application settings, and manage user roles here."
          />
        </Container>
      </main>
    </>
  );
}
