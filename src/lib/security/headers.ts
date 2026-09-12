/**
 * Canonical browser security headers for Saba Water Delivery.
 *
 * This is the SINGLE source of truth for the Content-Security-Policy and the
 * companion security headers. Next.js applies them for every route via
 * `async headers()` in `next.config.ts`. API routes and other code must not set
 * duplicate or conflicting security headers.
 *
 * The policy is derived from what this application actually loads in the
 * browser (audited for issue #31 — see TECHNICAL.md "Browser security headers /
 * CSP"), NOT copied from a generic template:
 *   - Client code uses only Firebase **Auth** (Google sign-in via
 *     `signInWithPopup`) and calls to the app's own same-origin API. There is
 *     no client-side Firestore, no Firebase Storage, and no analytics loaded in
 *     the browser today.
 *   - Fonts are self-hosted by `next/font` (served from `'self'`).
 *   - Server-only integrations (Meta/WhatsApp, Resend, Firestore Admin) are
 *     never contacted by the browser, so they are deliberately ABSENT here.
 *
 * CSP is defense in depth against injected/cross-site scripts and unapproved
 * resource loading; it does not make the app immune to XSS.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeaderEnv {
  /** `next dev` sets this to "development"; builds set "production". */
  nodeEnv?: string;
  /** Vercel sets this to "production" | "preview" | "development". */
  vercelEnv?: string;
  /** Public Firebase auth domain, e.g. `my-project.firebaseapp.com`. */
  authDomain?: string;
  /** When truthy, emit `Content-Security-Policy-Report-Only` instead of the
   * enforcing header (a documented rollout valve — see docs/DEPLOYMENT.md). */
  reportOnly?: boolean;
  /**
   * Local Firebase emulator `host:port` values (auth, firestore) present ONLY in
   * an E2E/emulator build (`NEXT_PUBLIC_FIREBASE_*_EMULATOR_HOST`). When set, the
   * CSP additionally allows the local emulator origins so the browser client can
   * reach them, and drops `upgrade-insecure-requests` (the emulators are plain
   * http on localhost). These variables are never set in a production build, so
   * the production policy is unchanged. See TECHNICAL.md "End-to-end testing".
   */
  emulatorHosts?: string[];
}

function readEnv(
  values: Record<string, string | undefined> = process.env,
): SecurityHeaderEnv {
  const emulatorHosts = [
    values.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    values.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST,
  ].filter((h): h is string => Boolean(h && h.trim()));

  return {
    nodeEnv: values.NODE_ENV,
    vercelEnv: values.VERCEL_ENV,
    authDomain: values.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    reportOnly: Boolean(
      values.CSP_REPORT_ONLY && values.CSP_REPORT_ONLY !== "false",
    ),
    emulatorHosts,
  };
}

// Google/Firebase Auth infrastructure the browser genuinely contacts during
// `signInWithPopup` and token refresh. These are the ONLY third-party origins
// in the policy; each is justified in TECHNICAL.md.
const GOOGLE_APIS_SCRIPT = "https://apis.google.com";
const FIREBASE_AUTH_CONNECT = [
  "https://identitytoolkit.googleapis.com", // sign-in / account lookup
  "https://securetoken.googleapis.com", // ID-token refresh
];
// Vercel's preview toolbar (developer tooling) — never in production.
const VERCEL_LIVE = "https://vercel.live";

const HSTS_MAX_AGE_SECONDS = 31536000; // 1 year (matches prior production value)

function buildCsp(env: SecurityHeaderEnv): SecurityHeader {
  const isProductionBuild = env.nodeEnv === "production";
  const isDevelopment = !isProductionBuild;
  const isPreview = env.vercelEnv === "preview";
  // Emulator (E2E) build only — never true in a production build.
  const emulatorHosts = env.emulatorHosts ?? [];
  const isEmulator = emulatorHosts.length > 0;
  const emulatorOrigins = emulatorHosts.flatMap((host) => [
    `http://${host}`,
    `ws://${host}`,
  ]);

  const authDomain = env.authDomain?.trim();
  const authFrameOrigin = authDomain ? [`https://${authDomain}`] : [];
  const authConnectOrigins = authDomain
    ? [`https://${authDomain}`, ...FIREBASE_AUTH_CONNECT]
    : [...FIREBASE_AUTH_CONNECT];

  // scripts: 'unsafe-inline' is required because Next.js App Router injects
  // per-render inline bootstrap/streaming scripts that cannot be hashed and
  // would otherwise need a nonce (which forces every page dynamic — see
  // TECHNICAL.md). No 'unsafe-eval' in production; dev needs it for React Fast
  // Refresh only.
  const scriptSrc = ["'self'", "'unsafe-inline'", GOOGLE_APIS_SCRIPT];
  if (isDevelopment) scriptSrc.push("'unsafe-eval'");
  if (isPreview) scriptSrc.push(VERCEL_LIVE);

  const connectSrc = ["'self'", ...authConnectOrigins];
  if (isDevelopment) connectSrc.push("ws://localhost:*", "ws://127.0.0.1:*"); // HMR websocket
  if (isPreview) connectSrc.push(VERCEL_LIVE, "wss://ws-us3.pusher.com");
  // E2E only: allow the browser client to reach the local Firebase emulators.
  if (isEmulator) connectSrc.push(...emulatorOrigins);

  const frameSrc = ["'self'", ...authFrameOrigin, GOOGLE_APIS_SCRIPT];
  if (isPreview) frameSrc.push(VERCEL_LIVE);

  const directives: [string, string | null][] = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["script-src", scriptSrc.join(" ")],
    // Inline style attributes (`style={{…}}`) and Next.js require 'unsafe-inline'.
    ["style-src", "'self' 'unsafe-inline'"],
    // data: covers next/image blur placeholders and small inline images.
    ["img-src", "'self' data:"],
    ["font-src", "'self'"], // next/font self-hosts Geist
    ["connect-src", connectSrc.join(" ")],
    ["frame-src", frameSrc.join(" ")],
    ["worker-src", "'self'"], // the PWA service worker (/sw.js)
    ["manifest-src", "'self'"],
    // Upgrade any stray http subresource to https in HTTPS environments; must
    // NOT apply in local http dev or an http emulator (E2E) build.
    ["upgrade-insecure-requests", isDevelopment || isEmulator ? null : ""],
  ];

  const value = directives
    .filter(([, source]) => source !== null)
    .map(([directive, source]) =>
      source ? `${directive} ${source}` : directive,
    )
    .join("; ");

  return {
    key: env.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value,
  };
}

/**
 * Conservative Permissions-Policy — every capability the app does not use is
 * disabled with an empty allowlist `()`. When a future feature needs one (e.g.
 * `camera` for photo capture), remove it here with an explicit review.
 */
function buildPermissionsPolicy(): SecurityHeader {
  const disabled = [
    "accelerometer",
    "autoplay",
    "browsing-topics",
    "camera",
    "clipboard-read",
    "clipboard-write",
    "cross-origin-isolated",
    "display-capture",
    "encrypted-media",
    "fullscreen",
    "geolocation",
    "gyroscope",
    "hid",
    "idle-detection",
    "magnetometer",
    "microphone",
    "midi",
    "payment",
    "picture-in-picture",
    "publickey-credentials-get",
    "screen-wake-lock",
    "serial",
    "usb",
    "xr-spatial-tracking",
  ];
  return {
    key: "Permissions-Policy",
    value: disabled.map((feature) => `${feature}=()`).join(", "),
  };
}

function buildHsts(env: SecurityHeaderEnv): SecurityHeader | undefined {
  // HSTS only matters over HTTPS (Vercel preview/production); it is ignored on
  // local http, so skip it in development to keep dev headers clean. No
  // `preload` (irreversible, and `vercel.app` is not ours to submit).
  const isProductionBuild = env.nodeEnv === "production";
  if (!isProductionBuild) return undefined;

  return {
    key: "Strict-Transport-Security",
    value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
  };
}

/**
 * The complete ordered list of security headers to apply to every route.
 */
export function buildSecurityHeaders(
  env: SecurityHeaderEnv = readEnv(),
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    buildCsp(env),
    // Allows the Firebase Google sign-in popup to keep its opener relationship.
    // `same-origin` (without `-allow-popups`) breaks `signInWithPopup`; COEP is
    // deliberately NOT set — it would block cross-origin resources and is not
    // needed. See TECHNICAL.md "COOP / COEP".
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Defense in depth for legacy clients that ignore CSP frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    buildPermissionsPolicy(),
  ];

  const hsts = buildHsts(env);
  if (hsts) headers.push(hsts);

  return headers;
}
