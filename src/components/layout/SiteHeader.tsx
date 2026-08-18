import Link from "next/link";

import { Container } from "@/components/ui/Container";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <span aria-hidden className="text-xl">💧</span>
          <span>Saba Water Delivery</span>
        </Link>
        <Link
          href="/login"
          className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          Log in
        </Link>
      </Container>
    </header>
  );
}
