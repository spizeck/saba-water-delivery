import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native tsconfig-path resolution lets the emulator tests import via `@/`.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    // Auth-emulator-backed tests run under `npm run test:auth-emulator`, which
    // starts the Firebase Auth + Firestore emulators. They exercise REAL
    // Admin Auth behavior (getUser/updateUser/revokeRefreshTokens/deleteUser,
    // ID-token + session-cookie verification) rather than mocks — that is the
    // point of the account-merge reconciliation coverage (issue #73).
    include: ["**/*.auth-emulator.test.ts"],
    // Run emulator-backed files one at a time so concurrency tests do not
    // contend on the shared emulator and cause spurious timeouts.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
