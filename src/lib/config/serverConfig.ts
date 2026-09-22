import "server-only";

/**
 * Centralized SERVER configuration boundary (issue #54).
 *
 * This module is the single canonical description of every environment variable
 * the deployed application consumes, and the one place that turns that
 * description into:
 *   - typed, validated getters for the values the app must have to operate
 *     safely (Firebase Admin credentials, the named database id); and
 *   - a SANITIZED status summary (`getServerConfigStatus`) that reports, per
 *     variable, whether it is `set` / `unset` / `invalid` and whether it is
 *     required in the current environment — WITHOUT ever exposing a value. That
 *     summary is the machine-usable source for a future admin diagnostics
 *     surface.
 *
 * Design (see docs/adr/0016):
 *   - Small, explicit, typed boundaries — not one giant universal config object.
 *   - Validation is deterministic and pure (`validators.ts`); this module only
 *     supplies the raw env and classifies requirements per environment.
 *   - Client/public Firebase config stays in `firebase/client.ts`; server
 *     credentials never cross into the browser. This module is `server-only`.
 *   - It changes NO existing semantics: rate limiting still fails open, optional
 *     integrations stay optional, readiness is still Firestore-only. It makes
 *     configuration STATE explicit; it does not make optional providers
 *     mandatory.
 */
import { isConfigError } from "./errors";
import {
  type Deployment,
  type DeploymentTarget,
  resolveDeployment,
} from "./deployment";
import { appOriginStatus } from "./appOrigin";
import {
  isPresent,
  optionalDatabaseId,
  requiredEmail,
  requiredPrivateKey,
  requiredString,
} from "./validators";

type EnvRecord = Record<string, string | undefined>;

// --- Typed getters for values the app must have to operate safely -----------

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  /** PEM private key with real newlines (env stores it with literal `\n`). */
  privateKey: string;
}

/**
 * Reads and validates the Firebase Admin service-account configuration.
 * Throws a sanitized {@link ConfigError} (never echoing the key) when a value
 * is missing or malformed. Callers (see `firebase/admin.ts`) use this ONLY on
 * the non-emulator path and only when initializing the Admin app — so a
 * deployment with no config still builds and only fails when the trusted server
 * is actually exercised.
 */
export function getFirebaseAdminConfig(
  env: EnvRecord = process.env,
): FirebaseAdminConfig {
  return {
    projectId: requiredString(
      "FIREBASE_ADMIN_PROJECT_ID",
      env.FIREBASE_ADMIN_PROJECT_ID,
    ),
    clientEmail: requiredEmail(
      "FIREBASE_ADMIN_CLIENT_EMAIL",
      env.FIREBASE_ADMIN_CLIENT_EMAIL,
    ),
    privateKey: requiredPrivateKey(
      "FIREBASE_ADMIN_PRIVATE_KEY",
      env.FIREBASE_ADMIN_PRIVATE_KEY,
    ),
  };
}

/**
 * The named Firestore database id override (`FIREBASE_DATABASE_ID`), validated.
 * Returns undefined when unset (meaning the project's `(default)` database).
 * Throws (value-free) when a present value is not a legal database id.
 */
export function getDatabaseId(
  env: EnvRecord = process.env,
): string | undefined {
  return optionalDatabaseId("FIREBASE_DATABASE_ID", env.FIREBASE_DATABASE_ID);
}

// --- Configuration registry (the canonical description) ---------------------

export type ConfigClassification = "public" | "server" | "secret";
export type ConfigLevel = "required" | "recommended" | "optional";
export type ConfigStatus = "set" | "unset" | "invalid";

interface ConfigDescriptor {
  variable: string;
  classification: ConfigClassification;
  /** Integration this variable belongs to, when it is feature-gated. */
  feature?: string;
  /** How important this variable is in the resolved environment. */
  level: (deployment: Deployment, env: EnvRecord) => ConfigLevel;
  /** Sanitized presence/validity — never returns or logs the value. */
  check: (env: EnvRecord) => ConfigStatus;
}

/** Presence-only check (any non-empty value is acceptable). */
function presence(name: string): (env: EnvRecord) => ConfigStatus {
  return (env) => (isPresent(env[name]) ? "set" : "unset");
}

/**
 * Presence + validation check. `unset` when absent; `invalid` when present but
 * the validator rejects it (a `ConfigError`); `set` when it validates.
 */
function validated(
  name: string,
  validate: (name: string, raw: string | undefined) => unknown,
): (env: EnvRecord) => ConfigStatus {
  return (env) => {
    if (!isPresent(env[name])) return "unset";
    try {
      validate(name, env[name]);
      return "set";
    } catch (error) {
      if (isConfigError(error)) return "invalid";
      throw error;
    }
  };
}

// Feature-enable signals: a feature is "enabled" once any of its variables is
// present, which lets us distinguish a DISABLED integration (all unset — fine)
// from a PARTIALLY configured one (some set — the rest become required).
const WHATSAPP_VARS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
];
function emailEnabled(env: EnvRecord): boolean {
  return isPresent(env.RESEND_API_KEY);
}
function sentryEnabled(env: EnvRecord): boolean {
  return isPresent(env.NEXT_PUBLIC_SENTRY_DSN);
}
function whatsappEnabled(env: EnvRecord): boolean {
  return WHATSAPP_VARS.some((v) => isPresent(env[v]));
}

// Level helpers.
const optionalAlways = (): ConfigLevel => "optional";
function coreLevel(d: Deployment): ConfigLevel {
  // Core Firebase config: supplied by the emulator locally; required in a
  // deployed cloud environment; recommended (but non-fatal) in local dev/CI,
  // where the app intentionally renders a "not configured" state.
  if (d.isEmulator) return "optional";
  return d.isDeployed ? "required" : "recommended";
}
const deployedRequired = (d: Deployment): ConfigLevel =>
  d.isDeployed ? "required" : "optional";
const productionRequired = (d: Deployment): ConfigLevel =>
  d.target === "production" ? "required" : "optional";
const deployedRecommended = (d: Deployment): ConfigLevel =>
  d.isDeployed ? "recommended" : "optional";
const emailField =
  () =>
  (_d: Deployment, env: EnvRecord): ConfigLevel =>
    emailEnabled(env) ? "required" : "optional";
const whatsappField =
  () =>
  (_d: Deployment, env: EnvRecord): ConfigLevel =>
    whatsappEnabled(env) ? "required" : "optional";
const sentryField =
  () =>
  (_d: Deployment, env: EnvRecord): ConfigLevel =>
    sentryEnabled(env) ? "recommended" : "optional";

/**
 * The canonical registry. Kept in sync with docs/DEPLOYMENT.md's configuration
 * table and .env.example. Adding a new consumed variable means adding it here.
 */
const REGISTRY: ConfigDescriptor[] = [
  // --- Firebase Admin (server) ---
  {
    variable: "FIREBASE_ADMIN_PROJECT_ID",
    classification: "server",
    level: coreLevel,
    check: presence("FIREBASE_ADMIN_PROJECT_ID"),
  },
  {
    variable: "FIREBASE_ADMIN_CLIENT_EMAIL",
    classification: "server",
    level: coreLevel,
    check: validated("FIREBASE_ADMIN_CLIENT_EMAIL", requiredEmail),
  },
  {
    variable: "FIREBASE_ADMIN_PRIVATE_KEY",
    classification: "secret",
    level: coreLevel,
    check: validated("FIREBASE_ADMIN_PRIVATE_KEY", requiredPrivateKey),
  },
  {
    variable: "FIREBASE_DATABASE_ID",
    classification: "server",
    level: optionalAlways,
    check: validated("FIREBASE_DATABASE_ID", optionalDatabaseId),
  },
  // --- Firebase client (public, build-time) ---
  {
    variable: "NEXT_PUBLIC_FIREBASE_API_KEY",
    classification: "public",
    level: coreLevel,
    check: presence("NEXT_PUBLIC_FIREBASE_API_KEY"),
  },
  {
    variable: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    classification: "public",
    level: coreLevel,
    check: presence("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  },
  {
    variable: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    classification: "public",
    level: coreLevel,
    check: presence("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  },
  {
    variable: "NEXT_PUBLIC_FIREBASE_APP_ID",
    classification: "public",
    level: coreLevel,
    check: presence("NEXT_PUBLIC_FIREBASE_APP_ID"),
  },
  // --- Public app origin ---
  {
    variable: "NEXT_PUBLIC_APP_URL",
    classification: "public",
    level: deployedRecommended,
    check: (env) => appOriginStatus(env),
  },
  // --- Security / abuse controls ---
  {
    variable: "RATE_LIMIT_HASH_SECRET",
    classification: "secret",
    // Required in deployed environments; when missing there the limiter fails
    // OPEN by design (ADR 0012) — this flags the misconfiguration without
    // changing that behavior.
    level: deployedRequired,
    check: presence("RATE_LIMIT_HASH_SECRET"),
  },
  {
    variable: "CSP_REPORT_ONLY",
    classification: "server",
    level: optionalAlways,
    check: presence("CSP_REPORT_ONLY"),
  },
  // --- Cron ---
  {
    variable: "CRON_SECRET",
    classification: "secret",
    level: productionRequired,
    check: presence("CRON_SECRET"),
  },
  // --- Resend email integration (optional; required-if-enabled) ---
  {
    variable: "RESEND_API_KEY",
    classification: "secret",
    feature: "resend-email",
    level: optionalAlways,
    check: presence("RESEND_API_KEY"),
  },
  {
    variable: "CONTINUITY_REPORT_EMAIL_FROM",
    classification: "server",
    feature: "resend-email",
    level: emailField(),
    check: validated("CONTINUITY_REPORT_EMAIL_FROM", requiredEmail),
  },
  {
    variable: "CONTINUITY_REPORT_EMAIL_TO",
    classification: "server",
    feature: "resend-email",
    level: emailField(),
    check: presence("CONTINUITY_REPORT_EMAIL_TO"),
  },
  {
    variable: "DELIVERY_CONFIRMATION_EMAIL_FROM",
    classification: "server",
    feature: "resend-email",
    level: optionalAlways, // falls back to CONTINUITY_REPORT_EMAIL_FROM
    check: validated("DELIVERY_CONFIRMATION_EMAIL_FROM", requiredEmail),
  },
  {
    variable: "ACCOUNT_SETUP_EMAIL_FROM",
    classification: "server",
    feature: "resend-email",
    level: optionalAlways, // falls back to CONTINUITY_REPORT_EMAIL_FROM
    check: validated("ACCOUNT_SETUP_EMAIL_FROM", requiredEmail),
  },
  // --- WhatsApp integration (optional; required-if-enabled) ---
  {
    variable: "WHATSAPP_ACCESS_TOKEN",
    classification: "secret",
    feature: "whatsapp",
    level: whatsappField(),
    check: presence("WHATSAPP_ACCESS_TOKEN"),
  },
  {
    variable: "WHATSAPP_PHONE_NUMBER_ID",
    classification: "server",
    feature: "whatsapp",
    level: whatsappField(),
    check: presence("WHATSAPP_PHONE_NUMBER_ID"),
  },
  {
    variable: "WHATSAPP_APP_SECRET",
    classification: "secret",
    feature: "whatsapp",
    level: whatsappField(),
    check: presence("WHATSAPP_APP_SECRET"),
  },
  {
    variable: "WHATSAPP_VERIFY_TOKEN",
    classification: "secret",
    feature: "whatsapp",
    level: whatsappField(),
    check: presence("WHATSAPP_VERIFY_TOKEN"),
  },
  // --- Sentry error monitoring (optional; issue #115) ---
  {
    // The DSN is public by design (it only identifies the ingest endpoint).
    // When absent, the whole integration disables cleanly — no crash, no
    // events, local/CI unaffected.
    variable: "NEXT_PUBLIC_SENTRY_DSN",
    classification: "public",
    feature: "sentry",
    level: deployedRecommended,
    check: presence("NEXT_PUBLIC_SENTRY_DSN"),
  },
  {
    variable: "SENTRY_ORG",
    classification: "server",
    feature: "sentry",
    // Needed (with SENTRY_PROJECT + token) for source-map upload; without it
    // the app still captures errors, just unsymbolicated.
    level: sentryField(),
    check: presence("SENTRY_ORG"),
  },
  {
    variable: "SENTRY_PROJECT",
    classification: "server",
    feature: "sentry",
    level: sentryField(),
    check: presence("SENTRY_PROJECT"),
  },
  {
    variable: "SENTRY_AUTH_TOKEN",
    classification: "secret",
    feature: "sentry",
    level: sentryField(),
    check: presence("SENTRY_AUTH_TOKEN"),
  },
  // --- Optional operational ---
  {
    variable: "LOG_LEVEL",
    classification: "server",
    level: optionalAlways,
    check: presence("LOG_LEVEL"),
  },
];

export interface ConfigStatusEntry {
  variable: string;
  classification: ConfigClassification;
  feature?: string;
  level: ConfigLevel;
  status: ConfigStatus;
}

export interface ServerConfigStatus {
  target: DeploymentTarget;
  isDeployed: boolean;
  isEmulator: boolean;
  entries: ConfigStatusEntry[];
  /** True when nothing required is unset and nothing is invalid. */
  ok: boolean;
  /** Variable names that are required in this environment but not set. */
  missingRequired: string[];
  /** Variable names present but malformed. */
  invalid: string[];
}

/**
 * Produces a sanitized configuration status for the resolved environment. This
 * NEVER returns configuration values — only each variable's classification,
 * required-level, and set/unset/invalid state — so it is safe to log, expose to
 * an authorized admin diagnostics surface, or serialize. It performs NO I/O and
 * does not initialize Firebase.
 */
export function getServerConfigStatus(
  env: EnvRecord = process.env,
): ServerConfigStatus {
  const deployment = resolveDeployment(env);

  const entries: ConfigStatusEntry[] = REGISTRY.map((d) => ({
    variable: d.variable,
    classification: d.classification,
    ...(d.feature ? { feature: d.feature } : {}),
    level: d.level(deployment, env),
    status: d.check(env),
  }));

  const missingRequired = entries
    .filter((e) => e.level === "required" && e.status !== "set")
    .map((e) => e.variable);
  const invalid = entries
    .filter((e) => e.status === "invalid")
    .map((e) => e.variable);

  return {
    target: deployment.target,
    isDeployed: deployment.isDeployed,
    isEmulator: deployment.isEmulator,
    entries,
    ok: missingRequired.length === 0 && invalid.length === 0,
    missingRequired,
    invalid,
  };
}
