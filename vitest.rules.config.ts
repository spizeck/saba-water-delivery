import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // tsconfigPaths lets the emulator tests import via the `@/` alias.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["firestore.rules.test.ts", "**/*.emulator.test.ts"],
    // Run emulator-backed files one at a time so a heavy concurrency test does
    // not contend with the rules tests on the shared emulator and cause
    // spurious timeouts.
    fileParallelism: false,
  },
});
