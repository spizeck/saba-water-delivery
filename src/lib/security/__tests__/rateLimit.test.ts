import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AppRateLimitError, isAppError } from "@/lib/errors";

import {
  InMemoryRateLimitStore,
  RATE_LIMIT_POLICIES,
  type RateLimitStore,
  checkRateLimit,
  enforceRateLimit,
  getTrustedClientIp,
} from "../rateLimit";

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VERCEL_ENV;
  delete process.env.RATE_LIMIT_HASH_SECRET;
});

/** A store that records the (hashed) keys it is asked to increment. */
function capturingStore(): { store: RateLimitStore; keys: string[] } {
  const keys: string[] = [];
  const store: RateLimitStore = {
    async increment(key, windowMs, nowMs) {
      keys.push(key);
      return { count: 1, resetAtMs: nowMs + windowMs };
    },
  };
  return { store, keys };
}

function logLines(level: "warn" | "error"): Record<string, unknown>[] {
  const idx = { debug: 0, info: 1, warn: 2, error: 3 }[level];
  return consoleSpies[idx].mock.calls.map(
    (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>,
  );
}

const uid = (value: string) => ({ type: "uid" as const, value });

describe("checkRateLimit — fixed window", () => {
  it("allows requests below the limit and rejects above it", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit } = RATE_LIMIT_POLICIES["request-create"];
    const now = 1_000_000;

    for (let i = 1; i <= limit; i += 1) {
      const d = await checkRateLimit("request-create", uid("u1"), {
        store,
        now,
      });
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(limit - i);
    }

    const over = await checkRateLimit("request-create", uid("u1"), {
      store,
      now,
    });
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("uses server-supplied time and resets after the window elapses", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit, windowMs } = RATE_LIMIT_POLICIES["request-create"];
    const start = 5_000_000;

    for (let i = 0; i < limit; i += 1) {
      await checkRateLimit("request-create", uid("u1"), { store, now: start });
    }
    expect(
      (await checkRateLimit("request-create", uid("u1"), { store, now: start }))
        .allowed,
    ).toBe(false);

    // Once the window has fully elapsed, the bucket resets.
    const after = await checkRateLimit("request-create", uid("u1"), {
      store,
      now: start + windowMs + 1,
    });
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(limit - 1);
  });

  it("isolates different identifiers and different policies", async () => {
    const store = new InMemoryRateLimitStore();
    const now = 2_000_000;
    const { limit } = RATE_LIMIT_POLICIES["request-create"];

    for (let i = 0; i < limit; i += 1) {
      await checkRateLimit("request-create", uid("busy"), { store, now });
    }
    // A different UID is unaffected...
    expect(
      (await checkRateLimit("request-create", uid("other"), { store, now }))
        .allowed,
    ).toBe(true);
    // ...and a different policy for the same UID is a separate bucket.
    expect(
      (await checkRateLimit("delivery-response", uid("busy"), { store, now }))
        .allowed,
    ).toBe(true);
  });

  it("normalizes IP identifiers (case-insensitive) to the same bucket", async () => {
    const seenKeys: string[] = [];
    const store: RateLimitStore = {
      async increment(key, windowMs, nowMs) {
        seenKeys.push(key);
        return { count: 1, resetAtMs: nowMs + windowMs };
      },
    };
    await checkRateLimit(
      "auth-session",
      { type: "ip", value: "2001:DB8::1" },
      {
        store,
        now: 1,
      },
    );
    await checkRateLimit(
      "auth-session",
      { type: "ip", value: "2001:db8::1" },
      {
        store,
        now: 1,
      },
    );
    expect(seenKeys[0]).toBe(seenKeys[1]); // same hashed bucket
  });

  it("skips (does not enforce) when there is no identifier value", async () => {
    const store = new InMemoryRateLimitStore();
    const d = await checkRateLimit(
      "auth-session",
      { type: "ip", value: null },
      { store },
    );
    expect(d.allowed).toBe(true);
    expect(d.enforced).toBe(false);
  });
});

describe("privacy — keys and logs never contain the raw identifier", () => {
  it("hashes the identifier into an opaque key (never the raw value)", async () => {
    let capturedKey = "";
    const store: RateLimitStore = {
      async increment(key, windowMs, nowMs) {
        capturedKey = key;
        return { count: 1, resetAtMs: nowMs + windowMs };
      },
    };
    await checkRateLimit(
      "auth-session",
      { type: "ip", value: "203.0.113.7" },
      { store, now: 1 },
    );
    expect(capturedKey).not.toContain("203.0.113.7");
    expect(capturedKey).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it("logs a security event on rejection with type only — never the raw IP", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit } = RATE_LIMIT_POLICIES["auth-session"];
    const ip = { type: "ip" as const, value: "198.51.100.9" };
    for (let i = 0; i <= limit; i += 1) {
      await checkRateLimit("auth-session", ip, { store, now: 1 });
    }
    const events = logLines("warn").filter(
      (l) => l.event === "security.rate_limit.exceeded",
    );
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).toContain("auth-session");
    expect(serialized).toContain('"identifierType":"ip"');
    expect(serialized).not.toContain("198.51.100.9");
  });

  it("includes the opaque uid on a uid-policy rejection (safe internal id)", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit } = RATE_LIMIT_POLICIES["request-create"];
    for (let i = 0; i <= limit; i += 1) {
      await checkRateLimit("request-create", uid("user_42"), { store, now: 1 });
    }
    const event = logLines("warn").find(
      (l) => l.event === "security.rate_limit.exceeded",
    );
    expect(event?.uid).toBe("user_42");
  });
});

describe("HMAC secret configuration", () => {
  const ip = { type: "ip" as const, value: "203.0.113.5" };

  it("produces deterministic opaque keys for a configured secret", async () => {
    process.env.RATE_LIMIT_HASH_SECRET = "prod-secret-abc";
    const { store, keys } = capturingStore();
    await checkRateLimit("auth-session", ip, { store, now: 1 });
    await checkRateLimit("auth-session", ip, { store, now: 1 });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different keys for different secrets", async () => {
    process.env.RATE_LIMIT_HASH_SECRET = "secret-one";
    const one = capturingStore();
    await checkRateLimit("auth-session", ip, { store: one.store, now: 1 });

    process.env.RATE_LIMIT_HASH_SECRET = "secret-two";
    const two = capturingStore();
    await checkRateLimit("auth-session", ip, { store: two.store, now: 1 });

    expect(one.keys[0]).not.toBe(two.keys[0]);
  });

  it("uses the deterministic local fallback when NOT deployed (VERCEL_ENV unset)", async () => {
    delete process.env.RATE_LIMIT_HASH_SECRET;
    delete process.env.VERCEL_ENV;
    const { store, keys } = capturingStore();
    const d = await checkRateLimit("auth-session", ip, { store, now: 1 });
    expect(d.enforced).toBe(true);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails open (never hashes with the static salt) when deployed without the secret", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.RATE_LIMIT_HASH_SECRET;
    const { store, keys } = capturingStore();

    const d = await checkRateLimit("auth-session", ip, { store, now: 1 });

    expect(d.allowed).toBe(true);
    expect(d.enforced).toBe(false);
    // The store is never touched, so no key was derived from the public salt.
    expect(keys).toHaveLength(0);
    // ...and a high-severity operational log names the misconfiguration.
    expect(
      logLines("error").some((e) => e.event === "rate_limit.secret_missing"),
    ).toBe(true);
    // No spurious rejection security event on a config failure.
    expect(
      logLines("warn").some((l) => l.event === "security.rate_limit.exceeded"),
    ).toBe(false);
  });

  it("also refuses the static fallback on preview without the secret", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.RATE_LIMIT_HASH_SECRET;
    const { store, keys } = capturingStore();
    const d = await checkRateLimit("auth-session", ip, { store, now: 1 });
    expect(d.enforced).toBe(false);
    expect(keys).toHaveLength(0);
  });
});

describe("fail-open on storage failure", () => {
  it("allows the request and logs an operational error when the store throws", async () => {
    const store: RateLimitStore = {
      async increment() {
        throw new Error("firestore unavailable");
      },
    };
    const d = await checkRateLimit("request-create", uid("u1"), { store });
    expect(d.allowed).toBe(true);
    expect(d.enforced).toBe(false);

    const errors = logLines("error");
    expect(
      errors.some((e) => e.event === "rate_limit.storage_unavailable"),
    ).toBe(true);
    // The security event for a REJECTION must NOT be emitted on a failure.
    expect(
      logLines("warn").some((l) => l.event === "security.rate_limit.exceeded"),
    ).toBe(false);
  });
});

describe("enforceRateLimit (HTTP path)", () => {
  it("throws AppRateLimitError (429/RATE_LIMITED/Retry-After) when exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const { limit } = RATE_LIMIT_POLICIES["auth-session"];
    const id = { type: "ip" as const, value: "203.0.113.1" };
    for (let i = 0; i < limit; i += 1) {
      await enforceRateLimit("auth-session", id, { store, now: 1 });
    }
    let thrown: unknown;
    try {
      await enforceRateLimit("auth-session", id, { store, now: 1 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppRateLimitError);
    expect(isAppError(thrown) && thrown.statusCode).toBe(429);
    expect(isAppError(thrown) && thrown.code).toBe("RATE_LIMITED");
    expect((thrown as AppRateLimitError).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("getTrustedClientIp", () => {
  function req(headers: Record<string, string> = {}): NextRequest {
    return new NextRequest("https://example.com/api/auth/session", { headers });
  }

  it("returns null when not running behind Vercel (untrusted headers)", () => {
    delete process.env.VERCEL_ENV;
    expect(
      getTrustedClientIp(req({ "x-forwarded-for": "1.2.3.4" })),
    ).toBeNull();
  });

  it("uses the leftmost x-forwarded-for entry behind Vercel", () => {
    process.env.VERCEL_ENV = "production";
    expect(
      getTrustedClientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })),
    ).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    process.env.VERCEL_ENV = "production";
    expect(getTrustedClientIp(req({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
    expect(getTrustedClientIp(req())).toBeNull();
  });
});
