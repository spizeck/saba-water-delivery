import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAdminDbMock } = vi.hoisted(() => ({
  getAdminDbMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

import { evaluateReadiness, withTimeout } from "../readiness";

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  getAdminDbMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The `console.error` spy (structured logs are emitted as JSON via console). */
function errorSpy(): ReturnType<typeof vi.spyOn> {
  // console.error is the 4th level in the array above.
  return consoleSpies[3];
}

/** A fake Firestore that records every method touched, to prove read-only use. */
function fakeFirestore(getResult: unknown = { exists: false }) {
  const calls: string[] = [];
  const getMock = vi.fn(async () => {
    calls.push("get");
    return getResult;
  });
  const setMock = vi.fn(() => calls.push("set"));
  const updateMock = vi.fn(() => calls.push("update"));
  const deleteMock = vi.fn(() => calls.push("delete"));
  const addMock = vi.fn(() => calls.push("add"));
  const docMock = vi.fn((id: string) => {
    calls.push(`doc:${id}`);
    return {
      get: getMock,
      set: setMock,
      update: updateMock,
      delete: deleteMock,
    };
  });
  const collectionMock = vi.fn((name: string) => {
    calls.push(`collection:${name}`);
    return { doc: docMock, add: addMock };
  });
  return {
    db: { collection: collectionMock },
    calls,
    getMock,
    setMock,
    updateMock,
    deleteMock,
    addMock,
  };
}

describe("evaluateReadiness", () => {
  it("is ready (200) when the injected Firestore probe succeeds", async () => {
    const result = await evaluateReadiness({
      probeFirestore: async () => {},
    });

    expect(result.status).toBe("ready");
    expect(result.httpStatus).toBe(200);
    expect(result.checks).toEqual({ app: "ok", firestore: "ok" });
  });

  it("is not_ready (503) when the Firestore probe fails", async () => {
    const result = await evaluateReadiness({
      probeFirestore: async () => {
        throw new Error("connection refused");
      },
    });

    expect(result.status).toBe("not_ready");
    expect(result.httpStatus).toBe(503);
    expect(result.checks).toEqual({ app: "ok", firestore: "unavailable" });
  });

  it("returns only safe categorical values — never the raw failure reason", async () => {
    const secret =
      "super-secret-service-account@project.iam.gserviceaccount.com";
    const result = await evaluateReadiness({
      probeFirestore: async () => {
        throw new Error(`PERMISSION_DENIED for ${secret}`);
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("PERMISSION_DENIED");
    // Only the coarse states appear.
    for (const value of [result.checks.app, result.checks.firestore]) {
      expect(["ok", "unavailable"]).toContain(value);
    }
  });

  it("logs a sanitized health.readiness.failed event on failure", async () => {
    await evaluateReadiness({
      probeFirestore: async () => {
        throw new Error("boom");
      },
    });

    expect(errorSpy()).toHaveBeenCalledTimes(1);
    const line = String(errorSpy().mock.calls[0]?.[0]);
    expect(line).toContain("health.readiness.failed");
    expect(line).toContain("firestore");
    // The error is serialized (has a name), not spread raw.
    expect(line).toContain('"name"');
  });

  it("emits no error or warn logs on a successful probe", async () => {
    await evaluateReadiness({ probeFirestore: async () => {} });

    expect(consoleSpies[3]).not.toHaveBeenCalled(); // error
    expect(consoleSpies[2]).not.toHaveBeenCalled(); // warn
  });

  it("stays ready regardless of optional integration configuration", async () => {
    // Optional integrations are intentionally non-blocking; clearing their
    // config must not affect readiness when Firestore is reachable.
    delete process.env.RESEND_API_KEY;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;

    const result = await evaluateReadiness({ probeFirestore: async () => {} });

    expect(result.status).toBe("ready");
  });

  describe("default Firestore probe", () => {
    it("issues a single read against the dedicated _health/probe path and no writes", async () => {
      const fake = fakeFirestore();
      getAdminDbMock.mockReturnValue(fake.db);

      const result = await evaluateReadiness();

      expect(result.status).toBe("ready");
      expect(fake.getMock).toHaveBeenCalledTimes(1);
      expect(fake.calls).toEqual(["collection:_health", "doc:probe", "get"]);
      // No mutating operation is ever issued during a readiness probe.
      expect(fake.setMock).not.toHaveBeenCalled();
      expect(fake.updateMock).not.toHaveBeenCalled();
      expect(fake.deleteMock).not.toHaveBeenCalled();
      expect(fake.addMock).not.toHaveBeenCalled();
    });

    it("is not_ready when Firebase Admin is unconfigured (getAdminDb throws)", async () => {
      getAdminDbMock.mockImplementation(() => {
        throw new Error(
          "Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, ...",
        );
      });

      const result = await evaluateReadiness();

      expect(result.status).toBe("not_ready");
      expect(result.httpStatus).toBe(503);
      expect(result.checks.firestore).toBe("unavailable");
      // The raw init error (which names env vars) never reaches the result.
      expect(JSON.stringify(result)).not.toContain("FIREBASE_ADMIN_PROJECT_ID");
    });

    it("is not_ready when the Firestore read rejects", async () => {
      const getMock = vi.fn().mockRejectedValue(new Error("UNAVAILABLE"));
      getAdminDbMock.mockReturnValue({
        collection: () => ({ doc: () => ({ get: getMock }) }),
      });

      const result = await evaluateReadiness();

      expect(result.status).toBe("not_ready");
      expect(result.httpStatus).toBe(503);
    });
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("done"), 1000)).resolves.toBe(
      "done",
    );
  });

  it("rejects when the promise does not settle before the timeout", async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    const pending = withTimeout(never, 3000);
    const assertion = expect(pending).rejects.toThrow(
      "readiness_probe_timeout",
    );
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("propagates the underlying rejection unchanged", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("inner")), 1000),
    ).rejects.toThrow("inner");
  });
});
