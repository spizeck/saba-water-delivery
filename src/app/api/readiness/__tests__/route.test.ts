import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAdminDbMock } = vi.hoisted(() => ({
  getAdminDbMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

import { GET } from "@/app/api/readiness/route";

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  getAdminDbMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/readiness",
    { headers },
  );
}

/** A Firestore whose single-document `.get()` resolves (reachable). */
function reachableFirestore() {
  return {
    collection: () => ({
      doc: () => ({ get: vi.fn().mockResolvedValue({ exists: false }) }),
    }),
  };
}

/** A Firestore whose `.get()` rejects with the given error (unreachable). */
function unreachableFirestore(error: Error) {
  return {
    collection: () => ({
      doc: () => ({ get: vi.fn().mockRejectedValue(error) }),
    }),
  };
}

describe("GET /api/readiness", () => {
  it("returns 200 and status 'ready' when Firestore is reachable", async () => {
    getAdminDbMock.mockReturnValue(reachableFirestore());

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ready",
      checks: { app: "ok", firestore: "ok" },
    });
  });

  it("returns 503 and status 'not_ready' when the Firestore probe fails", async () => {
    getAdminDbMock.mockReturnValue(unreachableFirestore(new Error("refused")));

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "not_ready",
      checks: { app: "ok", firestore: "unavailable" },
    });
  });

  it("carries an x-request-id header on both ready and not_ready responses", async () => {
    getAdminDbMock.mockReturnValue(reachableFirestore());
    const ready = await GET(makeRequest());
    expect(ready.headers.get("x-request-id")).toBeTruthy();

    getAdminDbMock.mockReturnValue(unreachableFirestore(new Error("x")));
    const notReady = await GET(makeRequest());
    expect(notReady.headers.get("x-request-id")).toBeTruthy();
  });

  it("echoes a safe inbound x-request-id", async () => {
    getAdminDbMock.mockReturnValue(reachableFirestore());
    const response = await GET(makeRequest({ "x-request-id": "monitor-42" }));
    expect(response.headers.get("x-request-id")).toBe("monitor-42");
  });

  it("never leaks the raw Firestore error, stack, secrets, or paths to the client", async () => {
    const secretMessage =
      "PERMISSION_DENIED: FIREBASE_ADMIN_PRIVATE_KEY=-----BEGIN PRIVATE KEY----- " +
      "project=saba-secret-project-987 sa=svc@saba-secret-project-987.iam.gserviceaccount.com";
    const error = new Error(secretMessage);
    error.stack = `Error: ${secretMessage}\n    at Firestore._get (/var/task/node_modules/firebase-admin/lib/firestore.js:1:1)`;
    getAdminDbMock.mockReturnValue(unreachableFirestore(error));

    const response = await GET(makeRequest());
    const text = await response.text();

    expect(response.status).toBe(503);
    // Body is exactly the safe categorical shape.
    expect(JSON.parse(text)).toEqual({
      status: "not_ready",
      checks: { app: "ok", firestore: "unavailable" },
    });
    // None of the sensitive material appears anywhere in the client response.
    for (const forbidden of [
      "FIREBASE_ADMIN_PRIVATE_KEY",
      "PRIVATE KEY",
      "PERMISSION_DENIED",
      "saba-secret-project-987",
      "gserviceaccount.com",
      "_health",
      "node_modules",
      "firebase-admin",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text.toLowerCase()).not.toContain("stack");
  });

  it("logs a sanitized failure but no error/warn noise on success", async () => {
    // Success path stays quiet.
    getAdminDbMock.mockReturnValue(reachableFirestore());
    await GET(makeRequest());
    expect(consoleSpies[3]).not.toHaveBeenCalled(); // no error
    expect(consoleSpies[2]).not.toHaveBeenCalled(); // no warn
    expect(consoleSpies[1]).not.toHaveBeenCalled(); // no info flood

    // Failure path logs exactly one structured error event.
    getAdminDbMock.mockReturnValue(unreachableFirestore(new Error("down")));
    await GET(makeRequest());
    expect(consoleSpies[3]).toHaveBeenCalledTimes(1);
    expect(String(consoleSpies[3].mock.calls[0]?.[0])).toContain(
      "health.readiness.failed",
    );
  });
});
