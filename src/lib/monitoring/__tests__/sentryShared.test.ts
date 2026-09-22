import { describe, expect, it } from "vitest";

import { AppAuthorizationError, AppValidationError } from "@/lib/errors";

import {
  buildSentryInitOptions,
  isExpectedBusinessError,
  normalizeUrlForSentry,
  resolveSentryEnv,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from "../sentryShared";

describe("resolveSentryEnv", () => {
  it("is disabled when no DSN is configured", () => {
    const env = resolveSentryEnv({ NODE_ENV: "test" });
    expect(env.enabled).toBe(false);
    expect(env.dsn).toBeUndefined();
  });

  it("is enabled only when a DSN AND production environment are present", () => {
    const env = resolveSentryEnv({
      NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
      VERCEL_ENV: "production",
    });
    expect(env.enabled).toBe(true);
    expect(env.environment).toBe("production");
  });

  it("is disabled in Production when the DSN is missing", () => {
    const env = resolveSentryEnv({ VERCEL_ENV: "production" });
    expect(env.enabled).toBe(false);
  });

  // Production-only policy: a DSN present in a non-production environment
  // still must not send telemetry.
  it("is disabled in Preview even when a DSN is present", () => {
    const env = resolveSentryEnv({
      NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
      VERCEL_ENV: "preview",
    });
    expect(env.enabled).toBe(false);
    expect(env.environment).toBe("preview");
  });

  it("is disabled in development/test even when a DSN is present", () => {
    for (const env of [
      { NODE_ENV: "development" },
      { NODE_ENV: "test" },
      { NODE_ENV: "production" }, // local prod build — no VERCEL_ENV
    ]) {
      expect(
        resolveSentryEnv({
          NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
          ...env,
        }).enabled,
      ).toBe(false);
    }
  });

  it("applies the gate client-side via the inlined NEXT_PUBLIC_SENTRY_ENVIRONMENT", () => {
    // The browser bundle cannot read VERCEL_ENV; next.config.ts inlines it.
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: "preview",
        NODE_ENV: "production",
      }).enabled,
    ).toBe(false);
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production",
        NODE_ENV: "production",
      }).enabled,
    ).toBe(true);
  });

  it("distinguishes production vs preview from VERCEL_ENV", () => {
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        VERCEL_ENV: "production",
      }).environment,
    ).toBe("production");
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        VERCEL_ENV: "preview",
      }).environment,
    ).toBe("preview");
  });

  it("falls back to the inlined NEXT_PUBLIC_SENTRY_ENVIRONMENT (client bundle)", () => {
    const env = resolveSentryEnv({
      NEXT_PUBLIC_SENTRY_DSN: "d",
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "preview",
      NODE_ENV: "production",
    });
    expect(env.environment).toBe("preview");
  });

  it("prefers the injected SENTRY_RELEASE, then the Vercel SHA", () => {
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        SENTRY_RELEASE: "rel-1",
        VERCEL_GIT_COMMIT_SHA: "sha-2",
      }).release,
    ).toBe("rel-1");
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        VERCEL_GIT_COMMIT_SHA: "sha-2",
      }).release,
    ).toBe("sha-2");
  });

  it("exposes the Vercel deployment id", () => {
    expect(
      resolveSentryEnv({
        NEXT_PUBLIC_SENTRY_DSN: "d",
        VERCEL_DEPLOYMENT_ID: "dpl_123",
      }).deploymentId,
    ).toBe("dpl_123");
  });
});

describe("buildSentryInitOptions", () => {
  it("never enables performance tracing, replay, profiling, or default PII", () => {
    const opts = buildSentryInitOptions("client", {
      NEXT_PUBLIC_SENTRY_DSN: "d",
    });
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.sendDefaultPii).toBe(false);
    // Structural: no replay/profiling keys are ever produced.
    expect("replaysSessionSampleRate" in opts).toBe(false);
    expect("profilesSampleRate" in opts).toBe(false);
  });

  it("filters transient browser noise on the client only", () => {
    const client = buildSentryInitOptions("client", {});
    const server = buildSentryInitOptions("server", {});
    expect(client.ignoreErrors.length).toBeGreaterThan(0);
    // A server-side "fetch failed" (e.g. undici → Firebase Admin) IS
    // actionable and must never be ignored.
    expect(server.ignoreErrors).toHaveLength(0);
  });
});

describe("isExpectedBusinessError", () => {
  it("treats bare SCREAMING_SNAKE domain codes as expected", () => {
    for (const code of [
      "DUPLICATE_ACTIVE_REQUEST",
      "DRIVER_IN_COOLDOWN",
      "LAST_ADMIN",
      "ALREADY_CLAIMED",
      "UNAUTHORIZED",
    ]) {
      expect(isExpectedBusinessError(new Error(code))).toBe(true);
    }
  });

  it("treats sub-500 AppErrors as expected", () => {
    expect(isExpectedBusinessError(new AppValidationError("Bad input."))).toBe(
      true,
    );
    expect(
      isExpectedBusinessError(new AppAuthorizationError("Forbidden.")),
    ).toBe(true);
  });

  it("does NOT treat unexpected errors as business states", () => {
    expect(
      isExpectedBusinessError(new TypeError("Cannot read properties of null")),
    ).toBe(false);
    expect(
      isExpectedBusinessError(
        new Error("fetch failed: connect ECONNREFUSED firestore"),
      ),
    ).toBe(false);
    expect(isExpectedBusinessError("string error")).toBe(false);
    expect(isExpectedBusinessError(undefined)).toBe(false);
  });
});

describe("scrubSentryEvent", () => {
  function makeEvent() {
    return {
      event_id: "evt-1",
      user: { id: "firebase-uid-123", email: "resident@example.com" },
      request: {
        method: "POST",
        url: "https://app.example.com/api/auth/session?token=abc",
        query_string: "token=abc",
        cookies: { session: "secret-cookie" },
        data: { idToken: "tok", custom: "body" },
        headers: {
          host: "app.example.com",
          authorization: "Bearer secret-token",
          cookie: "session=abc",
          "user-agent": "Mozilla/5.0",
          "x-request-id": "req-1",
        },
      },
      breadcrumbs: [
        {
          category: "console",
          message: "resident@example.com logged in",
          level: "info",
          timestamp: 1,
        },
        {
          category: "navigation",
          data: { from: "https://a.com/x?token=t", to: "https://a.com/y" },
          level: "info",
        },
        {
          category: "fetch",
          data: {
            method: "POST",
            status_code: 500,
            url: "https://a.com/api/thing?secret=1",
            request_body_size: 1024,
          },
        },
      ],
      tags: {
        requestId: "req-1",
        route: "api.auth.session",
        userId: "firebase-uid-123",
        email: "resident@example.com",
      },
      extra: {
        requestId: "req-1",
        requestBody: { name: "A Resident" },
      },
      contexts: {
        browser: { name: "Chrome", version: "120" },
        runtime: { name: "node" },
        request: { headers: { cookie: "x" } },
        device: { model: "iPhone" },
      },
      transaction: "/resident/review/abc123XYZ789def456",
      exception: {
        values: [
          {
            type: "Error",
            value: "Firestore failed for resident@example.com",
          },
        ],
      },
    };
  }

  it("drops the user object entirely", () => {
    const out = scrubSentryEvent(makeEvent())!;
    expect(out).not.toHaveProperty("user");
  });

  it("strips request body, cookies, query string, and non-allowlisted headers", () => {
    const out = scrubSentryEvent(makeEvent())!;
    const req = out.request as Record<string, unknown>;
    expect(req.method).toBe("POST");
    expect(req).not.toHaveProperty("data");
    expect(req).not.toHaveProperty("cookies");
    expect(req).not.toHaveProperty("query_string");
    const headers = req.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("Mozilla/5.0");
    expect(headers["x-request-id"]).toBe("req-1");
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("host");
  });

  it("strips the URL query string and normalizes identifier path segments", () => {
    const out = scrubSentryEvent(makeEvent())!;
    const req = out.request as Record<string, unknown>;
    expect(req.url).toBe("https://app.example.com/api/auth/session");
    expect(out.transaction).toBe("/resident/review/:id");
  });

  it("keeps breadcrumb shape but drops message/data payloads", () => {
    const out = scrubSentryEvent(makeEvent())!;
    const crumbs = out.breadcrumbs as Array<Record<string, unknown>>;
    const consoleCrumb = crumbs[0];
    expect(consoleCrumb.category).toBe("console");
    expect(consoleCrumb).not.toHaveProperty("message");
    expect(consoleCrumb).not.toHaveProperty("data");

    const nav = crumbs[1];
    expect((nav.data as Record<string, unknown>).to).toBe("https://a.com/y");
    expect((nav.data as Record<string, unknown>).from).toBe("https://a.com/x");

    const fetch = crumbs[2];
    const fetchData = fetch.data as Record<string, unknown>;
    expect(fetchData.method).toBe("POST");
    expect(fetchData.status_code).toBe(500);
    expect(fetchData.url).toBe("https://a.com/api/thing");
    expect(fetchData).not.toHaveProperty("request_body_size");
  });

  it("keeps only allowlisted tags and extra keys", () => {
    const out = scrubSentryEvent(makeEvent())!;
    expect(out.tags).toEqual({ requestId: "req-1", route: "api.auth.session" });
    expect(out.extra).toEqual({ requestId: "req-1" });
  });

  it("keeps only runtime-shaped contexts", () => {
    const out = scrubSentryEvent(makeEvent())!;
    const contexts = out.contexts as Record<string, unknown>;
    expect(contexts).toHaveProperty("browser");
    expect(contexts).toHaveProperty("runtime");
    expect(contexts).toHaveProperty("device");
    expect(contexts).not.toHaveProperty("request");
  });

  it("masks PII embedded in exception messages", () => {
    const out = scrubSentryEvent(makeEvent())!;
    const values = (out.exception as { values: Array<{ value: string }> })
      .values;
    expect(values[0].value).not.toContain("resident@example.com");
    expect(values[0].value).toContain("Firestore failed");
  });

  it("returns null (drops the event) when the exception is an expected business error", () => {
    const event = {
      exception: {
        values: [{ type: "Error", value: "DUPLICATE_ACTIVE_REQUEST" }],
      },
    };
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it("does not drop events whose messages merely look like prose", () => {
    const event = {
      exception: {
        values: [{ type: "Error", value: "Firestore connection failed" }],
      },
    };
    expect(scrubSentryEvent(event)).not.toBeNull();
  });
});

describe("scrubSentryBreadcrumb", () => {
  it("keeps only categorical fields for console/ui crumbs", () => {
    const out = scrubSentryBreadcrumb({
      category: "ui.click",
      message: "Resident Name button",
      data: { "data-sentry-component": "SubmitButton" },
      level: "info",
      timestamp: 5,
    });
    expect(out).toEqual({
      type: undefined,
      category: "ui.click",
      level: "info",
      timestamp: 5,
    });
  });
});

describe("normalizeUrlForSentry", () => {
  it("drops query and fragment", () => {
    expect(normalizeUrlForSentry("https://a.com/p?q=1&t=2#frag")).toBe(
      "https://a.com/p",
    );
  });

  it("normalizes Firestore-id-like and uuid-like segments", () => {
    expect(normalizeUrlForSentry("https://a.com/x/aB3dEf7Gh9JkLmN1PqRs")).toBe(
      "https://a.com/x/:id",
    );
    expect(
      normalizeUrlForSentry(
        "https://a.com/x/3f8b1c4e-2a4d-4f6a-9c1d-7e5f2a3b4c5d",
      ),
    ).toBe("https://a.com/x/:id");
  });

  it("keeps static route segments with hyphens", () => {
    expect(
      normalizeUrlForSentry("https://a.com/api/cron/continuity-report"),
    ).toBe("https://a.com/api/cron/continuity-report");
  });

  it("returns a placeholder for unparseable input", () => {
    expect(normalizeUrlForSentry("not a url")).toBe("[REDACTED]");
  });
});
