import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native tsconfig-path resolution lets the emulator tests import via `@/`.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    include: ["firestore.rules.test.ts", "**/*.emulator.test.ts"],
    // Run emulator-backed files one at a time so a heavy concurrency test does
    // not contend with the rules tests on the shared emulator and cause
    // spurious timeouts.
    fileParallelism: false,
    // The emulator serializes transactions pessimistically; concurrent tests
    // routinely exceed the 10s default under lock contention.
    testTimeout: 30_000,
  },
});
