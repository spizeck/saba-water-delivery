/**
 * MANDATORY production-safety guard for the E2E suite (issue #34).
 *
 * The E2E tests seed and mutate Firestore/Auth freely, so they must ONLY ever
 * run against local emulators backed by a disposable `demo-` project. This
 * module fails loudly and refuses to continue if anything looks like it could
 * touch real Firebase — no test, seed, or fixture may run until
 * `assertEmulatorSafety()` has passed. In particular, the destructive reset
 * helpers (`clearFirestore`/`clearAuthUsers`) call this before issuing their
 * HTTP DELETEs, so a mis-set host can never be wiped.
 *
 * The independent conditions:
 *   1. The Firestore AND Auth emulator host variables point at a LOOPBACK
 *      emulator at the expected port (never a remote IP, arbitrary hostname,
 *      URL with a scheme, alternate port, or empty value).
 *   2. The project id is a `demo-` project (Firebase's offline-only class) or
 *      the known E2E test id.
 *   3. We are NOT running in a deployed Vercel environment.
 */

import {
  AUTH_EMULATOR_PORT,
  E2E_PROJECT_ID,
  FIRESTORE_EMULATOR_PORT,
} from "./config";

/**
 * Loopback hostnames the emulators may bind to. `firebase.json` binds both
 * emulators to `127.0.0.1`; `localhost` and the IPv6 loopback `::1` are the
 * only other genuine loopback forms and are accepted explicitly rather than
 * loosening the check to arbitrary hosts.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

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
 * True only when `value` is a bare `host:port` (no scheme, no path) whose host
 * is a loopback address and whose port equals `expectedPort`. This is what
 * `firebase emulators:exec` sets for the local emulators; anything else — a
 * remote IP, an arbitrary hostname, a `http://…` URL, a different port, or an
 * empty value — is rejected so a destructive reset can never reach it.
 */
export function isLoopbackEmulatorHost(
  value: string | undefined,
  expectedPort: number,
): boolean {
  if (!value) return false;
  // Reject any scheme/URL form (e.g. "http://127.0.0.1:8080") or path.
  if (value.includes("/") || value.includes("://")) return false;

  let host: string;
  let port: string;
  if (value.startsWith("[")) {
    // Bracketed IPv6, e.g. "[::1]:9099".
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(value);
    if (!match) return false;
    host = match[1];
    port = match[2];
  } else {
    const lastColon = value.lastIndexOf(":");
    if (lastColon === -1) return false; // missing port
    host = value.slice(0, lastColon);
    port = value.slice(lastColon + 1);
    // A bare unbracketed IPv6 address still contains colons — reject it (the
    // only accepted IPv6 form is the bracketed "[::1]" above).
    if (host.includes(":")) return false;
  }

  if (!/^\d+$/.test(port)) return false;
  return LOOPBACK_HOSTS.has(host) && Number(port) === expectedPort;
}

/**
 * Throws unless the current environment is a safe local emulator environment.
 * Called at the very start of global setup and by the seed/reset helpers.
 */
export function assertEmulatorSafety(): void {
  const problems: string[] = [];

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") {
    problems.push(
      `refusing to run E2E in a deployed Vercel environment (VERCEL_ENV=${vercelEnv})`,
    );
  }

  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!isLoopbackEmulatorHost(firestoreHost, FIRESTORE_EMULATOR_PORT)) {
    problems.push(
      `FIRESTORE_EMULATOR_HOST must be the local emulator (expected ` +
        `127.0.0.1:${FIRESTORE_EMULATOR_PORT} or localhost:${FIRESTORE_EMULATOR_PORT}, ` +
        `got ${firestoreHost ?? "(unset)"})`,
    );
  }

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!isLoopbackEmulatorHost(authHost, AUTH_EMULATOR_PORT)) {
    problems.push(
      `FIREBASE_AUTH_EMULATOR_HOST must be the local emulator (expected ` +
        `127.0.0.1:${AUTH_EMULATOR_PORT} or localhost:${AUTH_EMULATOR_PORT}, ` +
        `got ${authHost ?? "(unset)"})`,
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
