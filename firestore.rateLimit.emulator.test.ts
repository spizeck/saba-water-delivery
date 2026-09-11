import { deleteApp, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FirestoreRateLimitStore } from "@/lib/security/rateLimit";

/**
 * Emulator-backed atomicity tests for the real Firestore rate-limit store.
 *
 * Runs only under `npm run test:rules` (`firebase emulators:exec` sets
 * FIRESTORE_EMULATOR_HOST, so the Admin SDK talks to the emulator with just a
 * projectId — no real credentials). It is excluded from the plain `vitest`
 * run, which has no emulator. This proves the transaction actually serializes
 * concurrent increments — the property that must not be mocked away.
 */

const PROJECT_ID = "demo-saba-rate-limit";
let app: ReturnType<typeof initializeApp>;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "rate-limit-emulator");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

describe("FirestoreRateLimitStore (emulator)", () => {
  it("counts concurrent increments atomically — no lost updates", async () => {
    const store = new FirestoreRateLimitStore(db);
    const key = `concurrency-${Date.now()}`;
    const now = Date.now();
    // All contending on ONE document — the worst case the transaction must
    // serialize. Kept modest because single-doc contention retries are slow
    // on the emulator; any N > 1 proves atomicity.
    const concurrency = 10;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        store.increment(key, 60_000, now),
      ),
    );

    // If the transaction is atomic, the returned counts are exactly 1..N with
    // no duplicates or gaps — every concurrent caller saw a distinct count.
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual(
      Array.from({ length: concurrency }, (_, i) => i + 1),
    );
  }, 30_000);

  it("starts a fresh window once the previous one has elapsed", async () => {
    const store = new FirestoreRateLimitStore(db);
    const key = `reset-${Date.now()}`;
    const t0 = Date.now();

    const first = await store.increment(key, 1_000, t0);
    expect(first.count).toBe(1);

    const second = await store.increment(key, 1_000, t0 + 500); // same window
    expect(second.count).toBe(2);

    const afterExpiry = await store.increment(key, 1_000, t0 + 2_000); // elapsed
    expect(afterExpiry.count).toBe(1);
  });
});
