import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "firestore.rules.test.ts",
      // Emulator-backed tests run under `npm run test:rules`, not the plain
      // `vitest` run (which has no Firebase emulator).
      "**/*.emulator.test.ts",
      // Playwright end-to-end specs (`e2e/tests/**`) run under `npm run test:e2e`
      // (Vitest would otherwise pick up the `.spec.ts` files and fail on
      // Playwright's API). Pure unit tests for the E2E support helpers
      // (`e2e/support/__tests__/**`) DO run here — they need no browser or
      // emulator — so only the Playwright specs are excluded, not all of `e2e/`.
      "e2e/tests/**",
    ],
  },
});
