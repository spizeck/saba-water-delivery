import { describe, expect, it } from "vitest";

import { serializeError } from "../serializeError";

describe("serializeError", () => {
  it("extracts name, message, and stack from an Error", () => {
    const result = serializeError(new TypeError("boom"));
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  it("includes a safe application/library error code when present", () => {
    const err = Object.assign(new Error("token expired"), {
      code: "auth/id-token-expired",
    });
    expect(serializeError(err).code).toBe("auth/id-token-expired");
  });

  it("includes a numeric status when present", () => {
    const err = Object.assign(new Error("bad gateway"), { status: 502 });
    expect(serializeError(err).status).toBe(502);
  });

  it("redacts email/phone embedded in the error message", () => {
    const result = serializeError(
      new Error("no email for resident@example.com"),
    );
    expect(result.message).not.toContain("resident@example.com");
    expect(result.message).toContain("[REDACTED_EMAIL]");
  });

  it("never spreads an arbitrary provider error object", () => {
    // A shape resembling an axios/fetch provider error with secrets nested in
    // config/headers/response — none of it must survive serialization.
    const providerError = Object.assign(new Error("Request failed"), {
      code: "ERR_BAD_RESPONSE",
      config: {
        headers: { Authorization: "Bearer super-secret-token" },
        url: "https://graph.facebook.com/v1/messages?access_token=EAAsecret",
      },
      response: {
        data: { recipient: "+599 416 1234", body: "raw message text" },
      },
    });

    const result = serializeError(providerError);
    const serialized = JSON.stringify(result);

    expect(result.name).toBe("Error");
    expect(result.code).toBe("ERR_BAD_RESPONSE");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("EAAsecret");
    expect(serialized).not.toContain("+599 416 1234");
    expect(serialized).not.toContain("raw message text");
    expect(result).not.toHaveProperty("config");
    expect(result).not.toHaveProperty("response");
  });

  it("handles non-Error throwables safely", () => {
    const result = serializeError("plain string failure");
    expect(result.name).toBe("NonError");
    expect(result.message).toBe("plain string failure");
  });

  it("omits the stack when includeStack is false", () => {
    const result = serializeError(new Error("x"), { includeStack: false });
    expect(result.stack).toBeUndefined();
  });

  it("produces a JSON-serializable object", () => {
    expect(() => JSON.stringify(serializeError(new Error("x")))).not.toThrow();
  });
});
