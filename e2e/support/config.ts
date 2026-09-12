/**
 * Single source of truth for the Playwright E2E environment (issue #34).
 *
 * Everything here describes the LOCAL, DISPOSABLE emulator environment the E2E
 * suite runs against — never production. The project id is `demo-`-prefixed,
 * which Firebase treats as an offline-only demo project that can never reach a
 * real Google Cloud project, and all hosts point at local emulators. See
 * `e2e/support/safety.ts` for the mandatory guard that refuses to run against
 * anything else, and docs/TESTING.md "End-to-end tests (Playwright)".
 */

/** Demo (offline-only) Firebase project id. The `demo-` prefix is required. */
export const E2E_PROJECT_ID = "demo-saba-water-delivery";

/** Local emulator hosts (must match `firebase.json` emulator ports). */
export const AUTH_EMULATOR_HOST = "127.0.0.1:9099";
export const FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

/** The app under test. */
export const APP_PORT = 3100;
export const APP_BASE_URL = `http://127.0.0.1:${APP_PORT}`;

/**
 * `NEXT_PUBLIC_*` values baked into the app at build time so the client SDK
 * uses the local Auth/Firestore emulators (see `src/lib/firebase/client.ts`).
 * These are demo/non-secret values — safe to keep in the repo.
 */
export const E2E_PUBLIC_ENV: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${E2E_PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${E2E_PROJECT_ID}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:e2edemo",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
  NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: FIRESTORE_EMULATOR_HOST,
};

/**
 * Server-side (Admin SDK) environment for the app process and seed scripts.
 * Setting the emulator host variables puts the Admin SDK into emulator mode
 * (see `src/lib/firebase/admin.ts`); no real service-account credential is
 * present or needed.
 */
export const E2E_SERVER_ENV: Record<string, string> = {
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST: FIRESTORE_EMULATOR_HOST,
  FIREBASE_ADMIN_PROJECT_ID: E2E_PROJECT_ID,
  GCLOUD_PROJECT: E2E_PROJECT_ID,
};

export type E2eRole = "resident" | "driver" | "dispatcher" | "admin";

export interface E2eAccount {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  roles: E2eRole[];
  /** Landing portal after login (the app's intendedPortal). */
  portal: E2eRole;
}

/**
 * Deterministic, synthetic test accounts. Passwords are throwaway values that
 * only ever exist in the local Auth emulator. Seeded once per run in
 * `global-setup.ts`.
 */
export const E2E_ACCOUNTS: Record<E2eRole, E2eAccount> = {
  resident: {
    uid: "e2e-resident",
    email: "resident@e2e.test",
    password: "e2e-resident-pw",
    displayName: "E2E Resident",
    roles: ["resident"],
    portal: "resident",
  },
  driver: {
    uid: "e2e-driver",
    email: "driver@e2e.test",
    password: "e2e-driver-pw",
    displayName: "E2E Driver",
    roles: ["driver"],
    portal: "driver",
  },
  dispatcher: {
    uid: "e2e-dispatcher",
    email: "dispatcher@e2e.test",
    password: "e2e-dispatcher-pw",
    displayName: "E2E Dispatcher",
    roles: ["dispatcher"],
    portal: "dispatcher",
  },
  admin: {
    uid: "e2e-admin",
    email: "admin@e2e.test",
    password: "e2e-admin-pw",
    displayName: "E2E Admin",
    roles: ["admin"],
    portal: "admin",
  },
};

/** The driver's linked Driver Registry document id. */
export const E2E_DRIVER_REGISTRY_ID = "e2e-driver-registry";

/** Default fill station id (matches DEFAULT_FILL_STATION_ID in the domain). */
export const E2E_DEFAULT_STATION_ID = "bottom";

/** A canonical Saba village used by the seeded resident profile. */
export const E2E_CANONICAL_VILLAGE = "Windwardside";
