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
// Private keys are typically stored with literal "\n" sequences in
// environment variables; convert them back to real newlines.
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const isFirebaseAdminConfigured = Boolean(projectId && clientEmail && privateKey);

let app: App | null = null;

function getAdminApp(): App {
  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, " +
        "FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY (see .env.example).",
    );
  }
  if (!app) {
    app =
      getApps()[0] ??
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
  }
  return app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
