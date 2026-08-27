import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";

import { RegisterPersonForm } from "./RegisterPersonForm";

export const metadata: Metadata = {
  title: "Register Person — Admin",
};

export default async function RegisterPersonPage() {
  const { profile } = await requireRole(["admin", "dispatcher"]);

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-2xl">
          <div>
            <Link
              href="/admin"
              className="text-sm text-blue-700 hover:underline"
            >
              &larr; Back to admin
            </Link>
          </div>
          <RegisterPersonForm />
        </Container>
      </main>
    </>
  );
}
