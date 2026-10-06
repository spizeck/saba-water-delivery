import type { Metadata } from "next";
import Link from "next/link";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { getAllUsers } from "@/lib/domain/admin";
import { getDispatchSettings } from "@/lib/domain/dispatchSettings";
import { cn } from "@/lib/utils/cn";
import { chipActionClasses } from "@/lib/utils/interactive";

import { DispatchSettingsForm } from "./DispatchSettingsForm";
import { UserList } from "./UserList";

export const metadata: Metadata = {
  title: "Admin — Saba Water Delivery",
};

export default async function AdminPortalPage() {
  const { profile } = await requireRole("admin");
  const [users, dispatchSettings] = await Promise.all([
    getAllUsers(),
    getDispatchSettings(),
  ]);

  return (
    <>
      <PortalHeader portalName="Admin" roles={profile.roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6 max-w-5xl">
          <Card>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-slate-900">
                  System Administration
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Manage users, roles, and driver access.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/drivers" className={chipActionClasses}>
                  Driver Registry
                </Link>
                <Link href="/statistics" className={chipActionClasses}>
                  View Statistics
                </Link>
                <Link
                  href="/admin/register"
                  className={cn(
                    chipActionClasses,
                    "!border-blue-200 !bg-blue-50 !text-blue-700 hover:!bg-blue-100 active:!bg-blue-200",
                  )}
                >
                  Register Person
                </Link>
                <Link href="/admin/users/merge" className={chipActionClasses}>
                  Merge Accounts
                </Link>
                <Link href="/admin/qr-codes" className={chipActionClasses}>
                  PWA QR Codes
                </Link>
              </div>
            </div>
          </Card>
          <DispatchSettingsForm settings={dispatchSettings} />
          <UserList users={users} />
        </Container>
      </main>
    </>
  );
}
