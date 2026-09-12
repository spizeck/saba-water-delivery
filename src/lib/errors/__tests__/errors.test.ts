import { describe, expect, it } from "vitest";

import {
  AppAuthenticationError,
  AppAuthorizationError,
  AppConflictError,
  AppInternalError,
  AppNotFoundError,
  AppRateLimitError,
  AppValidationError,
  GENERIC_ERROR_MESSAGE,
  isAppError,
} from "../appError";
import { buildApiErrorResponse, buildClientErrorBody } from "../apiResponse";
import { buildServerErrorContext, normalizeError } from "../normalize";

describe("AppError model", () => {
  it("maps categories to stable codes and statuses", () => {
    expect(new AppValidationError().code).toBe("VALIDATION_ERROR");
    expect(new AppValidationError().statusCode).toBe(400);
    expect(new AppAuthenticationError().statusCode).toBe(401);
    expect(new AppAuthorizationError().statusCode).toBe(403);
    expect(new AppNotFoundError().statusCode).toBe(404);
    expect(new AppConflictError().statusCode).toBe(409);
    expect(new AppRateLimitError().statusCode).toBe(429);
    expect(new AppInternalError().statusCode).toBe(500);
  });

  it("marks 4xx errors public and internal errors non-public", () => {
    expect(new AppValidationError("Bad email").isPublic).toBe(true);
    expect(new AppInternalError().isPublic).toBe(false);
  });

  it("isAppError distinguishes AppError from a plain Error", () => {
    expect(isAppError(new AppValidationError())).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError("nope")).toBe(false);
  });
});

describe("normalizeError", () => {
  it("returns a known AppError unchanged (preserves status/code/message)", () => {
    const original = new AppConflictError("Already claimed.");
    const normalized = normalizeError(original);
    expect(normalized).toBe(original);
    expect(normalized.statusCode).toBe(409);
    expect(normalized.message).toBe("Already claimed.");
  });

  it("wraps an unknown Error as a generic internal error, keeping the cause", () => {
    const cause = new TypeError("boom in firestore");
    const normalized = normalizeError(cause);
    expect(normalized).toBeInstanceOf(AppInternalError);
    expect(normalized.statusCode).toBe(500);
    expect(normalized.isPublic).toBe(false);
    expect(normalized.cause).toBe(cause);
  });

  it("wraps a non-Error throwable as internal with a redacted cause", () => {
    const normalized = normalizeError({ secretToken: "abc", note: "leak" });
    expect(normalized).toBeInstanceOf(AppInternalError);
    // The cause is redacted, not the raw object.
    expect(JSON.stringify(normalized.cause)).toContain("[REDACTED]");
  });
});

describe("buildServerErrorContext", () => {
  it("provides a sanitized cause for server logs (never raw secrets/PII)", () => {
    const cause = Object.assign(
      new Error("send to resident@example.com with Bearer sk_live_secret"),
      { code: "messaging/failure" },
    );
    const context = buildServerErrorContext(cause);
    const serialized = JSON.stringify(context);

    expect(context.category).toBe("internal");
    expect(context.code).toBe("INTERNAL_ERROR");
    // The original error remains available (as a sanitized cause) for
    // diagnosis, but its email/secret are masked.
    expect(serialized).toContain("messaging/failure");
    expect(serialized).not.toContain("resident@example.com");
    expect(serialized).not.toContain("sk_live_secret");
  });
});

describe("buildClientErrorBody / buildApiErrorResponse", () => {
  it("returns the public message for a public error, with code and requestId", () => {
    const body = buildClientErrorBody(
      new AppValidationError("Phone number is required."),
      "req-1",
    );
    expect(body).toEqual({
      error: "Phone number is required.",
      code: "VALIDATION_ERROR",
      requestId: "req-1",
    });
  });

  it("substitutes a generic message for non-public/internal errors", () => {
    const body = buildClientErrorBody(new AppInternalError(), "req-2");
    expect(body.error).toBe(GENERIC_ERROR_MESSAGE);
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("never exposes a raw exception message, stack, or provider detail", () => {
    const raw = Object.assign(
      new Error("Firestore: PERMISSION_DENIED at /var/task/app.js:12"),
      { response: { data: { token: "secret" } } },
    );
    const response = buildApiErrorResponse(raw, "req-3");
    return response.json().then((body) => {
      expect(response.status).toBe(500);
      expect(body.error).toBe(GENERIC_ERROR_MESSAGE);
      expect(body.code).toBe("INTERNAL_ERROR");
      expect(body.requestId).toBe("req-3");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("PERMISSION_DENIED");
      expect(serialized).not.toContain("/var/task");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("stack");
    });
  });

  it("preserves intended 4xx statuses for known errors", async () => {
    expect((await buildApiErrorResponse(new AppValidationError())).status).toBe(
      400,
    );
    expect(
      (await buildApiErrorResponse(new AppAuthenticationError())).status,
    ).toBe(401);
    expect(
      (await buildApiErrorResponse(new AppAuthorizationError())).status,
    ).toBe(403);
    expect((await buildApiErrorResponse(new AppNotFoundError())).status).toBe(
      404,
    );
    expect((await buildApiErrorResponse(new AppConflictError())).status).toBe(
      409,
    );
  });

  it("sets Retry-After for rate-limit errors", () => {
    const response = buildApiErrorResponse(
      new AppRateLimitError("Slow down.", 30),
      "req-4",
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
});
