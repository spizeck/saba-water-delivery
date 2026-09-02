import type { UserRole } from "@/lib/domain/types";

export type PwaPortal = "driver" | "resident";

export const PWA_PORTAL_PATHS: Record<PwaPortal, `/${PwaPortal}`> = {
  driver: "/driver",
  resident: "/resident",
};

export const PWA_INSTALL_PATHS: Record<PwaPortal, `/${PwaPortal}/install`> = {
  driver: "/driver/install",
  resident: "/resident/install",
};

export const PWA_MANIFEST_PATHS: Record<PwaPortal, `/${PwaPortal}-manifest.json`> = {
  driver: "/driver-manifest.json",
  resident: "/resident-manifest.json",
};

export const PWA_ROLES: Record<PwaPortal, UserRole> = {
  driver: "driver",
  resident: "resident",
};

/**
 * Deterministic production origin used for QR codes and PWA install links.
 *
 * Set `NEXT_PUBLIC_APP_URL` to the canonical public URL so QR codes always
 * point to production and never to a temporary preview deployment. The value
 * is read at build time for server-rendered QR code pages; while the pilot uses
 * the Vercel production domain as its fallback, this variable must be updated
 * when the permanent government DNS name becomes available.
 */
export function getAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  return "https://saba-water-delivery.vercel.app";
}

/** Absolute public URL for a PWA install portal. */
export function getPwaInstallUrl(portal: PwaPortal): string {
  return `${getAppOrigin()}${PWA_INSTALL_PATHS[portal]}`;
}
