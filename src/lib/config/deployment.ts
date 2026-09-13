/**
 * Deployment-target resolution (issue #54).
 *
 * A single, PURE, environment-injectable helper for the question several
 * modules were answering ad hoc from `VERCEL_ENV` / `NODE_ENV` / emulator
 * hosts: "which environment is this process running in, and is it a deployed
 * cloud environment?". Centralizing it removes duplicated `process.env.VERCEL_ENV
 * === "production" || "preview"` checks (rate limiter, Firebase admin guard,
 * security headers, logger) and gives tests a deterministic seam — they pass an
 * explicit env rather than depending on the developer's shell.
 *
 * This intentionally does NOT import `server-only`: the deployment target (from
 * public/ambient signals, never secrets) is also useful to build-time code such
 * as `security/headers.ts`.
 */

export type DeploymentTarget =
  | "production" // Vercel Production
  | "preview" // Vercel Preview
  | "test" // automated tests (vitest/playwright)
  | "development"; // local `next dev` / emulator work

export interface Deployment {
  target: DeploymentTarget;
  /** Vercel Production or Preview — where deployed-only requirements apply. */
  isDeployed: boolean;
  /** Firebase emulator hosts present (local dev / E2E only). */
  isEmulator: boolean;
  /** Raw signals, for callers/logging (never secret). */
  vercelEnv: string | undefined;
  nodeEnv: string | undefined;
}

type EnvRecord = Record<string, string | undefined>;

/**
 * True when the Firebase Admin emulator host variables are present. This is the
 * SERVER emulator signal (`FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`),
 * set by `firebase emulators:exec`. Kept here so the definition of "emulator
 * mode" lives in one place.
 */
export function isEmulatorMode(env: EnvRecord = process.env): boolean {
  return Boolean(
    env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST,
  );
}

/**
 * Resolves the deployment target from ambient signals. Precedence:
 *   1. `VERCEL_ENV` ("production" | "preview") — the authoritative deployed
 *      signal; nothing else can override it (a deployed env is deployed even if
 *      an emulator host is somehow present — the Firebase admin guard treats
 *      that combination as a hard error separately).
 *   2. emulator hosts or `NODE_ENV=test` → non-deployed test/development.
 *   3. `NODE_ENV=production` without a Vercel env (e.g. a local production
 *      build) → "production" but NOT `isDeployed` (no cloud secrets assumed).
 *   4. otherwise → "development".
 */
export function resolveDeployment(env: EnvRecord = process.env): Deployment {
  const vercelEnv = env.VERCEL_ENV;
  const nodeEnv = env.NODE_ENV;
  const emulator = isEmulatorMode(env);

  if (vercelEnv === "production" || vercelEnv === "preview") {
    return {
      target: vercelEnv,
      isDeployed: true,
      isEmulator: emulator,
      vercelEnv,
      nodeEnv,
    };
  }

  if (nodeEnv === "test") {
    return {
      target: "test",
      isDeployed: false,
      isEmulator: emulator,
      vercelEnv,
      nodeEnv,
    };
  }

  // A local/CI production build (NODE_ENV=production, no VERCEL_ENV) is
  // "production" for header/logging purposes but is NOT a deployed cloud
  // environment, so it does not trigger deployed-only requirements.
  const target: DeploymentTarget =
    nodeEnv === "production" ? "production" : "development";

  return {
    target,
    isDeployed: false,
    isEmulator: emulator,
    vercelEnv,
    nodeEnv,
  };
}

/** True on Vercel Production or Preview — where deployed-only config is required. */
export function isDeployedVercel(env: EnvRecord = process.env): boolean {
  return resolveDeployment(env).isDeployed;
}
