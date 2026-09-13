import { getAppOrigin } from "@/lib/config/appOrigin";
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

export const PWA_MANIFEST_PATHS: Record<
  PwaPortal,
  `/${PwaPortal}-manifest.json`
> = {
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
 * Re-exported from the centralized configuration boundary (`@/lib/config`,
 * issue #54) so QR codes, install links, and email links all resolve the app
 * origin identically (validated, trailing-slash normalized, one documented
 * fallback). Set `NEXT_PUBLIC_APP_URL` to the canonical public URL so links
 * never point to a temporary preview deployment.
 */
export { getAppOrigin };

/** Absolute public URL for a PWA install portal. */
export function getPwaInstallUrl(portal: PwaPortal): string {
  return `${getAppOrigin()}${PWA_INSTALL_PATHS[portal]}`;
}
