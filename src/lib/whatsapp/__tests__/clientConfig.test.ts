import { createHmac } from "crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getWhatsAppClientConfig,
  verifyWhatsAppWebhookChallenge,
  verifyWhatsAppWebhookSignature,
} from "@/lib/whatsapp/clientConfig";

const ORIGINAL_ENV = { ...process.env };

function setEnv() {
  process.env.WHATSAPP_ACCESS_TOKEN = "token-123";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "999888777";
  process.env.WHATSAPP_APP_SECRET = "shh-app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
}

describe("getWhatsAppClientConfig", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns null when any required variable is missing", () => {
    setEnv();
    delete process.env.WHATSAPP_APP_SECRET;
    expect(getWhatsAppClientConfig()).toBeNull();
  });

  it("returns the full config when all variables are set", () => {
    setEnv();
    expect(getWhatsAppClientConfig()).toEqual({
      accessToken: "token-123",
      phoneNumberId: "999888777",
      appSecret: "shh-app-secret",
      verifyToken: "verify-me",
    });
  });
});

describe("verifyWhatsAppWebhookChallenge", () => {
  const config = { accessToken: "a", phoneNumberId: "b", appSecret: "c", verifyToken: "verify-me" };

  it("echoes the challenge for a matching subscribe request", () => {
    expect(
      verifyWhatsAppWebhookChallenge(config, { mode: "subscribe", token: "verify-me", challenge: "1234" }),
    ).toBe("1234");
  });

  it("rejects a mismatched verify token", () => {
    expect(
      verifyWhatsAppWebhookChallenge(config, { mode: "subscribe", token: "wrong", challenge: "1234" }),
    ).toBeNull();
  });

  it("rejects a non-subscribe mode", () => {
    expect(
      verifyWhatsAppWebhookChallenge(config, { mode: "unsubscribe", token: "verify-me", challenge: "1234" }),
    ).toBeNull();
  });

  it("rejects a missing token", () => {
    expect(
      verifyWhatsAppWebhookChallenge(config, { mode: "subscribe", token: null, challenge: "1234" }),
    ).toBeNull();
  });
});

describe("verifyWhatsAppWebhookSignature", () => {
  const config = { accessToken: "a", phoneNumberId: "b", appSecret: "my-app-secret", verifyToken: "d" };
  const body = JSON.stringify({ hello: "world" });

  function validSignature(): string {
    return `sha256=${createHmac("sha256", config.appSecret).update(body, "utf8").digest("hex")}`;
  }

  it("accepts a correctly signed body", () => {
    expect(verifyWhatsAppWebhookSignature(config, body, validSignature())).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWhatsAppWebhookSignature(config, body, null)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const wrongSignature = `sha256=${createHmac("sha256", "wrong-secret").update(body, "utf8").digest("hex")}`;
    expect(verifyWhatsAppWebhookSignature(config, body, wrongSignature)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = validSignature();
    expect(verifyWhatsAppWebhookSignature(config, body + "tampered", sig)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(verifyWhatsAppWebhookSignature(config, body, "not-a-real-signature")).toBe(false);
    expect(verifyWhatsAppWebhookSignature(config, body, "sha1=abcd")).toBe(false);
  });
});
