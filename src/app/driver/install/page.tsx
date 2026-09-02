import type { Metadata, Viewport } from "next";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { Container } from "@/components/ui/Container";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  title: "Install Driver App — Saba Water Delivery",
  description:
    "Add the Saba Water Delivery driver app to your home screen for quick access.",
  manifest: "/driver-manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0ea5e9",
};

export default function DriverInstallPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-xl">
          <InstallPrompt portal="driver" title="Driver App" portalName="Driver" />
        </Container>
      </main>
    </>
  );
}
