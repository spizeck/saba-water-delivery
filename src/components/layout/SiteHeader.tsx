import Link from "next/link";

import { Container } from "@/components/ui/Container";
import { cn } from "@/lib/utils/cn";
import { navPillClasses } from "@/lib/utils/interactive";
import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-slate-900"
        >
          <Logo className="relative h-8 w-8" alt="Public Entity Saba" />
          <span>Saba Water Delivery</span>
        </Link>
        <Link
          href="/login"
          className={cn(
            navPillClasses,
            "text-blue-700 hover:bg-blue-50 active:bg-blue-100",
          )}
        >
          Log in
        </Link>
      </Container>
    </header>
  );
}
