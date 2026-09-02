import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import { OfflineBanner } from "@/components/pwa/OfflineBanner";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Saba Water Delivery",
  description:
    "Government RO water delivery request and driver dispatch system for Saba.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=2" },
      { url: "/favicon-16x16.png?v=2", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=2", sizes: "32x32", type: "image/png" },
      { url: "/favicon-96x96.png?v=2", sizes: "96x96", type: "image/png" },
      {
        url: "/android-icon-192x192.png?v=2",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [
      { url: "/apple-icon.png?v=2" },
      { url: "/apple-icon-57x57.png?v=2", sizes: "57x57", type: "image/png" },
      { url: "/apple-icon-60x60.png?v=2", sizes: "60x60", type: "image/png" },
      { url: "/apple-icon-72x72.png?v=2", sizes: "72x72", type: "image/png" },
      { url: "/apple-icon-76x76.png?v=2", sizes: "76x76", type: "image/png" },
      {
        url: "/apple-icon-114x114.png?v=2",
        sizes: "114x114",
        type: "image/png",
      },
      {
        url: "/apple-icon-120x120.png?v=2",
        sizes: "120x120",
        type: "image/png",
      },
      {
        url: "/apple-icon-144x144.png?v=2",
        sizes: "144x144",
        type: "image/png",
      },
      {
        url: "/apple-icon-152x152.png?v=2",
        sizes: "152x152",
        type: "image/png",
      },
      {
        url: "/apple-icon-180x180.png?v=2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/manifest.json?v=3",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Saba Water Delivery",
  },
  other: {
    "msapplication-TileColor": "#ffffff",
    "msapplication-TileImage": "/ms-icon-144x144.png?v=2",
    "msapplication-config": "/browserconfig.xml?v=2",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0ea5e9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-slate-50 font-sans text-slate-900 antialiased">
        <AuthProvider>
          <OfflineBanner />
          {children}
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
