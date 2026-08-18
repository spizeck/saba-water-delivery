import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { AuthProvider } from "@/lib/auth/AuthProvider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Saba Water Delivery",
  description:
    "Government RO water delivery request and driver dispatch system for Saba.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-slate-50 font-sans text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
