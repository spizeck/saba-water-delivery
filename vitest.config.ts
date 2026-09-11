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
    ],
  },
});
