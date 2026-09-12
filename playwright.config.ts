import { defineConfig, devices } from "@playwright/test";

import {
  APP_BASE_URL,
  APP_PORT,
  E2E_PUBLIC_ENV,
  E2E_SERVER_ENV,
} from "./e2e/support/config";

const isCI = Boolean(process.env.CI);

/**
 * Playwright E2E configuration (issue #34).
 *
 * The suite runs against LOCAL Firebase emulators only — it is launched by
 * `npm run test:e2e`, which wraps `playwright test` in `firebase emulators:exec`
 * so the Auth + Firestore emulators are running and their host env vars are set
 * (see docs/TESTING.md). `global-setup.ts` enforces the production-safety guard
 * and seeds deterministic data before any test runs.
 *
 * Chromium only: a reliable single-browser suite is more valuable here than
 * flaky multi-browser coverage; cross-browser can be added later.
 *
 * Serial (`workers: 1`): the specs seed and read shared emulator state and log
 * in through the real session flow, so a single worker removes cross-test
 * interference. The suite is intentionally small and fast; parallelism can be
 * introduced once per-test isolation is proven.
 */
export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  // Local: no retries, so flakiness surfaces immediately. CI: a single retry to
  // absorb rare emulator/network hiccups — never used to paper over an unstable
  // test (a test that only passes on retry must be fixed).
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build with the emulator NEXT_PUBLIC_* values inlined, then serve. Both the
    // build and the server receive the env below, so the client SDK targets the
    // Auth emulator and the Admin SDK runs in emulator mode.
    command: `npm run build && npm run start -- -p ${APP_PORT}`,
    url: APP_BASE_URL,
    // Never attach to a pre-existing server. Playwright must always start THIS
    // emulator-configured build; if something else is already listening on the
    // port the run fails fast rather than silently driving an unrelated app that
    // may be pointed at real Firebase (Aikido finding). This is a load-bearing
    // production-safety property — asserted in e2e/support/__tests__.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...E2E_PUBLIC_ENV,
      ...E2E_SERVER_ENV,
      NODE_ENV: "production",
    },
  },
});
