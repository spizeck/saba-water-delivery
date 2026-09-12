/**
 * MANDATORY production-safety guard for the E2E suite (issue #34).
 *
 * The E2E tests seed and mutate Firestore/Auth freely, so they must ONLY ever
 * run against local emulators backed by a disposable `demo-` project. This
 * module fails loudly and refuses to continue if anything looks like it could
 * touch real Firebase — no test, seed, or fixture may run until
 * `assertEmulatorSafety()` has passed.
 *
 * The three independent conditions:
 *   1. The Firestore AND Auth emulator host variables are present (so the SDKs
 *      are pointed at local emulators, never real Google endpoints).
 *   2. The project id is a `demo-` project (Firebase's offline-only class) or
 *      the known E2E test id.
 *   3. We are NOT running in a deployed Vercel environment.
 */

import { E2E_PROJECT_ID } from "./config";

function resolveProjectId(): string | undefined {
  return (
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  );
}

/** True when a project id is safe to run destructive E2E seeding against. */
export function isSafeEmulatorProject(projectId: string | undefined): boolean {
  return Boolean(
    projectId &&
    (projectId.startsWith("demo-") || projectId === E2E_PROJECT_ID),
  );
}

/**
 * Throws unless the current environment is a safe local emulator environment.
 * Called at the very start of global setup and by the seed helpers.
 */
export function assertEmulatorSafety(): void {
  const problems: string[] = [];

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") {
    problems.push(
      `refusing to run E2E in a deployed Vercel environment (VERCEL_ENV=${vercelEnv})`,
    );
  }

  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    problems.push(
      "FIRESTORE_EMULATOR_HOST is not set (Firestore emulator required)",
    );
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    problems.push(
      "FIREBASE_AUTH_EMULATOR_HOST is not set (Auth emulator required)",
    );
  }

  const projectId = resolveProjectId();
  if (!isSafeEmulatorProject(projectId)) {
    problems.push(
      `project id ${projectId ?? "(unset)"} is not a demo/test project — ` +
        `expected a "demo-" prefix or "${E2E_PROJECT_ID}"`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "E2E safety guard tripped — refusing to run against non-emulator Firebase:\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n\nRun the suite with `npm run test:e2e`, which starts the Firebase " +
        "emulators and sets the required environment. See docs/TESTING.md.",
    );
  }
}
