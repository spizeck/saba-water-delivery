/**
 * Canonical public application origin (issue #54).
 *
 * `NEXT_PUBLIC_APP_URL` is the public, build-time origin used for QR codes, PWA
 * install links, and the links embedded in account-setup / delivery-confirmation
 * emails. It was previously resolved in three places with subtly different
 * normalization (two stripped a trailing slash, one did not). This is now the
 * single source of truth.
 *
 * It is a `NEXT_PUBLIC_*` value (safe in the browser bundle) and is read at
 * BUILD time, so it must never hard-throw — CI builds the app with no
 * configuration set. When unset it falls back to the documented pilot origin;
 * `serverConfig.getServerConfigStatus()` separately reports it as a warning when
 * a deployed environment has not set it (see docs/adr/0016). A present value is
 * still validated/normalized so a malformed URL cannot silently ship in links.
 */
import { isPresent, parseHttpUrl } from "./validators";

/**
 * Documented pilot fallback origin. During the pilot the app is served from the
 * Vercel production domain; this must be replaced by setting
 * `NEXT_PUBLIC_APP_URL` to the permanent government origin once DNS is
 * configured. See .env.example / docs/DEPLOYMENT.md.
 */
export const DEFAULT_APP_ORIGIN = "https://saba-water-delivery.vercel.app";

const APP_URL_VAR = "NEXT_PUBLIC_APP_URL";

type EnvRecord = Record<string, string | undefined>;

/**
 * Returns the canonical app origin with no trailing slash. A configured
 * `NEXT_PUBLIC_APP_URL` is validated and normalized to its origin; a blank value
 * falls back to {@link DEFAULT_APP_ORIGIN}. If a present value is a malformed
 * URL it falls back to the default rather than throwing (this runs at build
 * time and inside best-effort email paths) — the malformed state is surfaced by
 * the config status summary, not by crashing a build or a delivery.
 */
export function getAppOrigin(env: EnvRecord = process.env): string {
  const raw = env[APP_URL_VAR];
  if (!isPresent(raw)) return DEFAULT_APP_ORIGIN;
  try {
    return parseHttpUrl(APP_URL_VAR, raw);
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/**
 * Whether `NEXT_PUBLIC_APP_URL` is set to a valid absolute http(s) URL. Used by
 * the config status summary to distinguish "unset (using pilot fallback)" and
 * "set but malformed" from "explicitly configured".
 */
export function appOriginStatus(
  env: EnvRecord = process.env,
): "set" | "unset" | "invalid" {
  const raw = env[APP_URL_VAR];
  if (!isPresent(raw)) return "unset";
  try {
    parseHttpUrl(APP_URL_VAR, raw);
    return "set";
  } catch {
    return "invalid";
  }
}
