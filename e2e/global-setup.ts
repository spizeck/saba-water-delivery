/**
 * Playwright global setup (issue #34).
 *
 * Runs once before the suite: verifies the mandatory production-safety guard,
 * clears the emulators to a known-empty state, then seeds the deterministic
 * baseline (accounts, profiles, fill stations, driver registry). Per-test state
 * is created inside individual specs with unique ids, so tests stay independent
 * and order-free.
 */

import { assertEmulatorSafety } from "./support/safety";
import { clearAuthUsers, clearFirestore, seedBaseline } from "./support/seed";

async function globalSetup(): Promise<void> {
  // Fail loudly before touching anything if this is not a safe emulator env.
  assertEmulatorSafety();

  await clearFirestore();
  await clearAuthUsers();
  await seedBaseline();
}

export default globalSetup;
