import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllUsers } from "@/lib/domain/admin";

import { MergeAccountsForm } from "./MergeAccountsForm";

export const metadata: Metadata = {
  title: "Merge Accounts — Admin",
};

export default async function MergeAccountsPage() {
  const { profile } = await requireRole("admin");
  const users = await getAllUsers();

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-4xl">
          <Card>
            <h1 className="text-2xl font-bold text-slate-900">Merge Resident Accounts</h1>
            <p className="mt-1 text-sm text-slate-600">
              Consolidate two authenticated accounts into one canonical account. Request history,
              driver registry links, and selected roles can be moved. Historical actor fields are
              preserved.
            </p>
          </Card>

          <MergeAccountsForm users={users} />
        </Container>
      </main>
    </>
  );
}
