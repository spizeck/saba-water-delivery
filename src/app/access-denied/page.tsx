import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Access denied — Saba Water Delivery",
};

interface AccessDeniedPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  const session = await getSessionUser();
  const { reason } = await searchParams;

  const isDriverReason = reason === "driver";

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-md">
          <Card>
            <h1 className="text-xl font-bold text-slate-900">
              {isDriverReason ? "Driver access not enabled" : "Access denied"}
            </h1>
            <p className="mt-2 text-slate-600">
              {isDriverReason
                ? "Driver access is not enabled for this account. Please contact the Water Delivery Office if you believe this is incorrect."
                : session
                  ? `Your account (${session.profile.roles.join(", ")}) doesn't have access to that page.`
                  : "You need to log in to view that page."}
            </p>
            <div className="mt-4">
              <LinkButton
                href={
                  session
                    ? session.profile.roles.includes("resident")
                      ? "/resident"
                      : `/${session.profile.roles[0] ?? "resident"}`
                    : "/"
                }
              >
                {session ? "Go to my portal" : "Return to home"}
              </LinkButton>
            </div>
          </Card>
        </Container>
      </main>
    </>
  );
}
