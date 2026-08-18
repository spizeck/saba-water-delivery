import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";

import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = {
  title: "Resident — Saba Water Delivery",
};

export default async function ResidentPortalPage() {
  const { profile } = await requireRole("resident");
  const profileComplete = Boolean(profile.village?.trim() && profile.deliveryDirections?.trim());

  return (
    <>
      <PortalHeader portalName="Resident" />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6">
          <Card>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome{profile.displayName ? `, ${profile.displayName}` : ""}
            </h1>
            <p className="mt-2 text-slate-600">
              {profileComplete
                ? "Your delivery information is on file."
                : "Complete your profile below so drivers know where to deliver your water."}
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">Request water</h2>
            <p className="mt-2 text-slate-600">
              {profileComplete
                ? "Water requests aren't open yet in this version of the app \u2014 check back soon."
                : "Complete your profile below to unlock water requests."}
            </p>
            <Button size="lg" disabled className="mt-4">
              Request 1,000 Gallons
            </Button>
          </Card>

          <ProfileForm profile={profile} />
        </Container>
      </main>
    </>
  );
}
