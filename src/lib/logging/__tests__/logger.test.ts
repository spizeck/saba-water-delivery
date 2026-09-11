import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLogger, withLogContext } from "../logger";

type ConsoleLevel = "debug" | "info" | "warn" | "error";

/** Captures each console line emitted during `fn`, parsed as JSON. */
function captureLogs(fn: () => void): Record<string, unknown>[] {
  const levels: ConsoleLevel[] = ["debug", "info", "warn", "error"];
  const spies = levels.map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );

  fn();

  const lines: Record<string, unknown>[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      lines.push(JSON.parse(String(call[0])));
    }
    spy.mockRestore();
  }
  return lines;
}

const originalLogLevel = process.env.LOG_LEVEL;

beforeEach(() => {
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = originalLogLevel;
  }
  vi.restoreAllMocks();
});

describe("Logger", () => {
  it("emits a single JSON line with the standard fields", () => {
    const log = getLogger("test.component");
    const lines = captureLogs(() =>
      log.info("request.create.ok", { loads: 2 }),
    );

    expect(lines).toHaveLength(1);
    const entry = lines[0];
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("request.create.ok");
    expect(entry.component).toBe("test.component");
    expect(entry.loads).toBe(2);
    expect(typeof entry.timestamp).toBe("string");
    expect(typeof entry.env).toBe("string");
  });

  it("includes request/correlation IDs from the ambient context", () => {
    const log = getLogger("test.component");
    const lines = captureLogs(() =>
      withLogContext({ requestId: "req-123", correlationId: "corr-9" }, () => {
        log.warn("dispatch.claim.failed");
      }),
    );
    expect(lines[0].requestId).toBe("req-123");
    expect(lines[0].correlationId).toBe("corr-9");
  });

  it("redacts secrets and PII passed in extra metadata", () => {
    const log = getLogger("test.component");
    const lines = captureLogs(() =>
      log.error("email.delivery_confirmation.failed", {
        requestId: "req_1",
        email: "resident@example.com",
        phone: "+599 416 1234",
        deliveryDirections: "Blue house",
        idToken: "eyJsecret",
        providerError: "failed to send to resident@example.com",
      }),
    );
    const serialized = JSON.stringify(lines[0]);
    expect(lines[0].requestId).toBe("req_1");
    expect(lines[0].email).toBe("[REDACTED]");
    expect(lines[0].phone).toBe("[REDACTED]");
    expect(lines[0].deliveryDirections).toBe("[REDACTED]");
    expect(lines[0].idToken).toBe("[REDACTED]");
    expect(serialized).not.toContain("resident@example.com");
    expect(serialized).not.toContain("eyJsecret");
  });

  it("respects LOG_LEVEL and suppresses lower levels", () => {
    process.env.LOG_LEVEL = "warn";
    const log = getLogger("test.component");
    const lines = captureLogs(() => {
      log.debug("debug.event");
      log.info("info.event");
      log.warn("warn.event");
      log.error("error.event");
    });
    const events = lines.map((l) => l.event);
    expect(events).not.toContain("debug.event");
    expect(events).not.toContain("info.event");
    expect(events).toContain("warn.event");
    expect(events).toContain("error.event");
  });

  it("never throws, even on circular metadata", () => {
    const log = getLogger("test.component");
    const circular: Record<string, unknown> = { safe: "ok" };
    circular.self = circular;
    expect(() => log.info("weird.event", circular)).not.toThrow();
  });

  it("always emits JSON-serializable output", () => {
    const log = getLogger("test.component");
    const lines = captureLogs(() =>
      log.info("some.event", { nested: { a: [1, 2, { b: "c" }] } }),
    );
    expect(() => JSON.stringify(lines[0])).not.toThrow();
  });
});

describe("LOG_LEVEL validation", () => {
  const validLevels = ["debug", "info", "warn", "error"] as const;

  it.each(validLevels)("accepts the valid level %s", (level) => {
    process.env.LOG_LEVEL = level;
    const log = getLogger("t");
    // The configured minimum level always emits its own level.
    const lines = captureLogs(() => log[level](`${level}.event`));
    expect(lines.map((l) => l.event)).toContain(`${level}.event`);
  });

  // Inherited property names (constructor/toString/__proto__) must NOT be
  // accepted as levels — the `in` operator would have let them through, which
  // would suppress every real level, including errors.
  const invalidLevels = ["constructor", "toString", "__proto__", "banana"];

  it.each(invalidLevels)(
    "falls back to the safe default (never disables logging) for LOG_LEVEL=%s",
    (bad) => {
      process.env.LOG_LEVEL = bad;
      const log = getLogger("t");
      const events = captureLogs(() => {
        log.error("error.event");
        log.warn("warn.event");
        log.info("info.event");
      }).map((l) => l.event);
      // Errors especially must never be silently swallowed by a bad value.
      expect(events).toContain("error.event");
      expect(events).toContain("warn.event");
      expect(events).toContain("info.event");
    },
  );
});

describe("critical-path logging does not leak personal data", () => {
  it("does not emit raw WhatsApp message content or sender phone", () => {
    const log = getLogger("whatsapp.handler");
    // Even if a caller mistakenly passes raw content, redaction must catch it.
    const lines = captureLogs(() =>
      log.error("whatsapp.message.processing_failed", {
        messageType: "text",
        rawBody: "I need water, call +599 416 1234",
        senderPhone: "+599 416 1234",
      }),
    );
    const serialized = JSON.stringify(lines[0]);
    expect(lines[0].messageType).toBe("text");
    // The phone number must not survive anywhere in the emitted line.
    expect(serialized).not.toContain("+599 416 1234");
    // The senderPhone key is redacted wholesale; the phone embedded in the
    // rawBody free text is masked by value scrubbing.
    expect(lines[0].senderPhone).toBe("[REDACTED]");
    expect(String(lines[0].rawBody)).toContain("[REDACTED_PHONE]");
  });

  it("masks resident directions/notes and provider emails on the failure path", () => {
    const log = getLogger("domain.waterRequests");
    const lines = captureLogs(() =>
      log.error("email.delivery_confirmation.notify_failed", {
        requestId: "req_5",
        requestNotes: "leave at the blue gate",
        providerError: "550 rejected resident@example.com",
      }),
    );
    const serialized = JSON.stringify(lines[0]);
    expect(lines[0].requestId).toBe("req_5");
    expect(serialized).not.toContain("leave at the blue gate");
    expect(serialized).not.toContain("resident@example.com");
  });
});
