import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Disables ESLint stylistic rules that would conflict with Prettier.
  // Keep last among the shared configs so its overrides win.
  prettier,
  {
    rules: {
      // Domain-layer stub functions intentionally take unused parameters
      // (prefixed with `_`) to document their eventual signature.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Application code must go through the canonical structured logger
  // (`@/lib/logging`) rather than console.* — this keeps redaction and
  // request-context correlation in force (see TECHNICAL.md). Scoped to `src/`
  // so CLI scripts under `scripts/` keep their legitimate console output.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
  {
    // The logger itself is the ONE place allowed to write to the console — it
    // is how structured entries reach Vercel's log stream.
    files: ["src/lib/logging/logger.ts"],
    rules: { "no-console": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
