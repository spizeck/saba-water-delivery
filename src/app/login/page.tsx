import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/SiteHeader";
import { Container } from "@/components/ui/Container";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in — Saba Water Delivery",
};

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center py-12">
        <Container className="max-w-md">
          <LoginForm />
        </Container>
      </main>
    </>
  );
}
