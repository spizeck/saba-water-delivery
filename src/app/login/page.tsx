import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Container } from "@/components/ui/Container";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in — Saba Water Delivery",
};

interface LoginPageProps {
  searchParams: Promise<{ portal?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { portal } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-md">
          <LoginForm intendedPortal={portal ?? null} />
        </Container>
      </main>
      <Footer />
    </>
  );
}
