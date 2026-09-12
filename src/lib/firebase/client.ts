"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, getAuth } from "firebase/auth";
import {
  type Firestore,
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";

/**
 * Firebase client SDK configuration.
 *
 * These values are safe to expose to the browser by design (see
 * TECHNICAL.md "Server vs Client") — actual access control is enforced by
 * Firebase Authentication and Firestore Security Rules, not by keeping
 * this config secret.
 *
 * All values are read from NEXT_PUBLIC_* environment variables so the
 * project can be configured per-environment without code changes. See
 * .env.example for the full list.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True once all required client config values are present. */
export const isFirebaseClientConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

/**
 * Local Firebase emulator hosts, used ONLY by the Playwright E2E suite and
 * local emulator development. When `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is
 * present (e.g. "127.0.0.1:9099"), the client Auth SDK is pointed at the local
 * Auth emulator so tests can sign in with seeded email/password users instead
 * of live Google OAuth. These `NEXT_PUBLIC_*` variables are build-time inlined
 * and are NEVER set for a production build, so a production bundle never
 * contains an emulator connection. See docs/TESTING.md.
 */
const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
const firestoreEmulatorHost =
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST;

/** True when the client should talk to local emulators rather than real Firebase. */
export const isFirebaseEmulatorMode = Boolean(authEmulatorHost);

let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

/**
 * Lazily initializes and returns the Firebase client app.
 *
 * Returns `null` when required configuration is missing (e.g. during
 * local development before a Firebase project has been created) instead
 * of throwing, so the rest of the app can render a clear "not configured"
 * state rather than crashing.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseClientConfigured) return null;
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!auth) {
    auth = getAuth(firebaseApp);
    // Must run before the SDK's first network call (guarded to run once).
    if (isFirebaseEmulatorMode && !authEmulatorConnected) {
      authEmulatorConnected = true;
      connectAuthEmulator(auth, `http://${authEmulatorHost}`, {
        disableWarnings: true,
      });
    }
  }
  return auth;
}

export function getFirebaseDb(): Firestore | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!db) {
    db = getFirestore(firebaseApp);
    if (
      isFirebaseEmulatorMode &&
      firestoreEmulatorHost &&
      !firestoreEmulatorConnected
    ) {
      firestoreEmulatorConnected = true;
      const [host, port] = firestoreEmulatorHost.split(":");
      connectFirestoreEmulator(db, host, Number(port));
    }
  }
  return db;
}
