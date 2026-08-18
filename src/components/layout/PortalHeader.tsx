import Link from "next/link";

import { Container } from "@/components/ui/Container";
import { LogoutButton } from "@/components/layout/LogoutButton";

export function PortalHeader({ portalName }: { portalName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">💧</span>
          <span className="font-bold text-slate-900">Saba Water Delivery</span>
          <span className="hidden text-slate-400 sm:inline">/</span>
          <span className="hidden font-semibold text-slate-600 sm:inline">
            {portalName}
          </span>
        </div>
        <div className="flex items-center gap-1">
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
