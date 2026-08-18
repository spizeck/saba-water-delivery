import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Access denied — Saba Water Delivery",
};

export default async function AccessDeniedPage() {
  const session = await getSessionUser();

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-md">
          <Card>
            <h1 className="text-xl font-bold text-slate-900">Access denied</h1>
            <p className="mt-2 text-slate-600">
              {session
                ? `Your account (${session.profile.role}) doesn't have access to that page.`
                : "You need to log in to view that page."}
            </p>
            <div className="mt-4">
              <LinkButton href={session ? `/${session.profile.role}` : "/login"}>
                {session ? "Go to my portal" : "Log in"}
              </LinkButton>
            </div>
          </Card>
        </Container>
      </main>
    </>
  );
}
