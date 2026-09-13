import "server-only";

import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

import { isDeployedVercel, isEmulatorMode } from "@/lib/config/deployment";
import {
  getDatabaseId,
  getFirebaseAdminConfig,
} from "@/lib/config/serverConfig";
import { isPresent } from "@/lib/config/validators";

/**
 * Firebase Admin SDK configuration for trusted server-side operations.
 *
 * This module must never be imported from a Client Component. The
 * `server-only` import above causes a build error if that happens by
 * mistake.
 *
 * Credentials come from a Firebase service account and must never be
 * committed to the repository. The values are read and validated through the
 * centralized configuration boundary (`@/lib/config`, issue #54); see
 * .env.example for the required variables.
 */

/**
 * Firebase emulator mode — the Admin SDK connects to LOCAL emulators when
 * `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST` are set (the
 * standard Firebase convention, set automatically by
 * `firebase emulators:exec`). It is ONLY ever active for local development and
 * the Playwright E2E suite; those variables are never set in a deployed Vercel
 * environment. In emulator mode a real service-account credential is neither
 * present nor needed — the emulators ignore credentials — so the app
 * initializes with just a project id. This never weakens production auth: see
 * `assertNotDeployedEmulatorMode()` below, which fails closed if these
 * variables ever appear in Vercel Production/Preview. See docs/TESTING.md
 * "End-to-end tests (Playwright)".
 */
const emulatorMode = isEmulatorMode();

const emulatorProjectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID ??
  process.env.GCLOUD_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "demo-saba-water-delivery";

/**
 * Fails closed if emulator mode is ever detected in a deployed Vercel
 * environment (Production or Preview). This should be impossible — Vercel never
 * sets the emulator host variables — but the assertion guarantees a
 * misconfiguration can never make the trusted server talk to a local emulator
 * instead of real, credentialed Firebase.
 */
function assertNotDeployedEmulatorMode(): void {
  if (emulatorMode && isDeployedVercel()) {
    throw new Error(
      "Refusing to use Firebase emulator hosts in a deployed Vercel environment.",
    );
  }
}

/**
 * Whether the trusted server has what it needs to run. Emulator mode needs only
 * the emulator hosts (which imply a usable project id); otherwise the three
 * Firebase Admin credential variables must be PRESENT. This is a presence check
 * only — a present-but-malformed value still reports "configured" and then
 * surfaces a precise, value-free `ConfigError` when the app is actually
 * initialized (see `getAdminApp`), preserving the existing fail-on-use timing.
 */
export const isFirebaseAdminConfigured = emulatorMode
  ? true
  : isPresent(process.env.FIREBASE_ADMIN_PROJECT_ID) &&
    isPresent(process.env.FIREBASE_ADMIN_CLIENT_EMAIL) &&
    isPresent(process.env.FIREBASE_ADMIN_PRIVATE_KEY);

let app: App | null = null;

function getAdminApp(): App {
  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY (see .env.example).",
    );
  }
  if (!app) {
    assertNotDeployedEmulatorMode();
    if (getApps()[0]) {
      app = getApps()[0];
    } else if (emulatorMode) {
      // Emulator mode: no real credential — the Auth/Firestore emulators
      // accept any project and ignore credentials.
      app = initializeApp({ projectId: emulatorProjectId });
    } else {
      // Validated here (not at import) so a deployment with no/bad config still
      // builds and only fails when the trusted server is actually used, with a
      // sanitized ConfigError that never echoes the private key.
      const { projectId, clientEmail, privateKey } = getFirebaseAdminConfig();
      app = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    }
  }
  return app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/**
 * Which Firestore database the trusted server reads and writes. Defaults to the
 * project's `(default)` database. `FIREBASE_DATABASE_ID` is a disaster-recovery
 * override (validated): after a managed restore into a differently-named
 * database (e.g. `recovery-YYYYMMDD`), an operator can point the deployed app at
 * the validated restore without a code change. Resolved lazily (per call) so a
 * malformed id surfaces as a `ConfigError` when the db is actually used, not at
 * import. See docs/DISASTER_RECOVERY.md.
 */
export function getAdminDb(): Firestore {
  const databaseId = getDatabaseId();
  return databaseId
    ? getFirestore(getAdminApp(), databaseId)
    : getFirestore(getAdminApp());
}
