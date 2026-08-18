import type { Metadata } from "next";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Dispatcher — Saba Water Delivery",
};

export default function DispatcherPortalPage() {
  return (
    <>
      <PortalHeader portalName="Dispatcher" />
      <main className="flex-1 py-8">
        <Container>
          <ComingSoon
            title="Operations overview"
            description="Dispatchers will see new/open requests, preferred-driver holds, claimed and aging requests, disputes, and delivered/unconfirmed deliveries here."
          />
        </Container>
      </main>
    </>
  );
}
