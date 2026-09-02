import type { Metadata, Viewport } from "next";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { Container } from "@/components/ui/Container";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  title: "Install Resident App — Saba Water Delivery",
  description:
    "Add the Saba Water Delivery resident app to your home screen for quick access.",
  manifest: "/resident-manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0ea5e9",
};

export default function ResidentInstallPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-xl">
          <InstallPrompt portal="resident" title="Resident App" portalName="Resident" />
        </Container>
      </main>
    </>
  );
}
