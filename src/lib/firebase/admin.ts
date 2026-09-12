import "server-only";

import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK configuration for trusted server-side operations.
 *
 * This module must never be imported from a Client Component. The
 * `server-only` import above causes a build error if that happens by
 * mistake.
 *
 * Credentials come from a Firebase service account and must never be
 * committed to the repository. See .env.example for the required
 * variables.
 */
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

/**
 * Which Firestore database the trusted server reads and writes. Defaults to the
 * project's `(default)` database. It exists as an env override for
 * disaster-recovery: after a managed restore into a differently-named database
 * (e.g. `recovery-YYYYMMDD`), an operator can point the deployed app at the
 * validated restore by setting `FIREBASE_DATABASE_ID` in Vercel — without a code
 * change — instead of only being able to address `(default)`. Client-side
 * Firestore is not used for data access (see TECHNICAL.md "Server vs Client"),
 * so this server-side selection governs which database the app actually serves.
 * See docs/DISASTER_RECOVERY.md.
 */
const databaseId = process.env.FIREBASE_DATABASE_ID?.trim() || undefined;
// Private keys are typically stored with literal "\n" sequences in
// environment variables; convert them back to real newlines.
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
  /\\n/g,
  "\n",
);

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
const isEmulatorMode = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST,
);

const emulatorProjectId =
  projectId ??
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
  const vercelEnv = process.env.VERCEL_ENV;
  if (
    isEmulatorMode &&
    (vercelEnv === "production" || vercelEnv === "preview")
  ) {
    throw new Error(
      "Refusing to use Firebase emulator hosts in a deployed Vercel environment.",
    );
  }
}

// A configured deployment needs a real service account; emulator mode needs
// only the emulator hosts (which imply a usable project id).
export const isFirebaseAdminConfigured = isEmulatorMode
  ? true
  : Boolean(projectId && clientEmail && privateKey);

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
    app =
      getApps()[0] ??
      (isEmulatorMode
        ? // Emulator mode: no real credential — the Auth/Firestore emulators
          // accept any project and ignore credentials.
          initializeApp({ projectId: emulatorProjectId })
        : initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
          }));
  }
  return app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return databaseId
    ? getFirestore(getAdminApp(), databaseId)
    : getFirestore(getAdminApp());
}
