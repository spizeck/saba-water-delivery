import Link from "next/link";

import { Container } from "@/components/ui/Container";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-6">
      <Container className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="text-sm text-slate-600">
          &copy; {year} Public Entity Saba — Water Delivery
        </p>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/privacy"
            className="text-slate-600 hover:text-slate-900 hover:underline"
          >
            Privacy Policy
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/terms"
            className="text-slate-600 hover:text-slate-900 hover:underline"
          >
            Terms of Use
          </Link>
        </nav>
      </Container>
    </footer>
  );
}
