import Link from "next/link";

import { Container } from "@/components/ui/Container";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { RoleSwitcher } from "@/components/layout/RoleSwitcher";
import type { UserRole } from "@/lib/domain/types";
import { Logo } from "./Logo";

interface PortalHeaderProps {
  portalName: string;
  /** User's roles — when multiple, the role switcher is shown. */
  roles?: UserRole[];
}

export function PortalHeader({ portalName, roles }: PortalHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="relative h-8 w-8" alt="Public Entity Saba" />
          <span className="font-bold text-slate-900">Saba Water Delivery</span>
          <span className="hidden text-slate-400 sm:inline">/</span>
          <span className="hidden font-semibold text-slate-600 sm:inline">
            {portalName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {roles && roles.length > 1 && (
            <RoleSwitcher roles={roles} currentPortal={portalName.toLowerCase()} />
          )}
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Home
          </Link>
          <LogoutButton />
        </div>
      </Container>
    </header>
  );
}
