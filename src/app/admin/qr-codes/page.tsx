import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { PrintButton } from "@/components/pwa/PrintButton";
import { QrCode } from "@/components/pwa/QrCode";
import { requireRole } from "@/lib/auth/session";
import { getPwaInstallUrl, PWA_INSTALL_PATHS } from "@/lib/pwa/constants";

export const metadata: Metadata = {
  title: "PWA QR Codes — Saba Water Delivery",
  description: "Printable QR codes for the driver and resident PWA install pages.",
};

export default async function QrCodesPage() {
  const { profile } = await requireRole("admin");

  const driverUrl = getPwaInstallUrl("driver");
  const residentUrl = getPwaInstallUrl("resident");

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="max-w-5xl">
          <Card className="print:shadow-none">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">PWA Install QR Codes</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Print these codes and post them at the RO plant or hand them to drivers and
                  residents.
                </p>
              </div>
              <PrintButton />
            </div>

            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 print:hidden">
              <p>
                Make sure <code className="font-mono">NEXT_PUBLIC_APP_URL</code> is set to the
                public production origin before printing. If it is not set, the fallback URL{" "}
                <code className="font-mono">{getPwaInstallUrl("driver")}</code> may not be reachable.
              </p>
            </div>

            <div className="mt-8 grid gap-8 sm:grid-cols-2 print:grid-cols-2 print:gap-12">
              <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-6 text-center">
                <h2 className="text-lg font-bold text-slate-900">Saba Water Delivery</h2>
                <p className="text-sm font-medium text-blue-700">Driver App</p>
                <p className="mb-4 text-xs text-slate-500">Scan to install</p>
                <QrCode
                  value={driverUrl}
                  label="Driver App"
                  alt={`QR code for driver install: ${driverUrl}`}
                />
                <p className="mt-4 text-xs text-slate-400">{PWA_INSTALL_PATHS.driver}</p>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-6 text-center">
                <h2 className="text-lg font-bold text-slate-900">Saba Water Delivery</h2>
                <p className="text-sm font-medium text-emerald-700">Resident App</p>
                <p className="mb-4 text-xs text-slate-500">Scan to install</p>
                <QrCode
                  value={residentUrl}
                  label="Resident App"
                  alt={`QR code for resident install: ${residentUrl}`}
                />
                <p className="mt-4 text-xs text-slate-400">{PWA_INSTALL_PATHS.resident}</p>
              </div>
            </div>
          </Card>
        </Container>
      </main>
    </>
  );
}
