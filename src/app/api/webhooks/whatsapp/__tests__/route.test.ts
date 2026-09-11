import { createHmac } from "crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimMessageIdMock, handleIncomingMock } = vi.hoisted(() => ({
  claimMessageIdMock: vi.fn(),
  handleIncomingMock: vi.fn(),
}));

vi.mock("@/lib/whatsapp/idempotency", () => ({
  claimMessageId: claimMessageIdMock,
}));
vi.mock("@/lib/whatsapp/handleIncomingMessage", () => ({
  handleIncomingWhatsAppMessage: handleIncomingMock,
}));
// client.ts carries a `server-only` guard (it makes the real Meta API
// call), so it can't be imported directly under vitest — mock it with
// the REAL pure config/verification logic from clientConfig.ts (no
// `server-only` guard) so signature/challenge behavior is genuinely
// exercised, not faked.
vi.mock("@/lib/whatsapp/client", async () => {
  const configModule = await vi.importActual<
    typeof import("@/lib/whatsapp/clientConfig")
  >("@/lib/whatsapp/clientConfig");
  return {
    getWhatsAppClientConfig: configModule.getWhatsAppClientConfig,
    verifyWhatsAppWebhookChallenge: configModule.verifyWhatsAppWebhookChallenge,
    verifyWhatsAppWebhookSignature: configModule.verifyWhatsAppWebhookSignature,
    sendWhatsAppTextMessage: vi.fn(),
  };
});

import * as whatsappClient from "@/lib/whatsapp/client";

import { GET, POST } from "@/app/api/webhooks/whatsapp/route";

const ORIGINAL_ENV = { ...process.env };
const APP_SECRET = "test-app-secret";

function setEnv() {
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
}

function messagePayload(messageId = "wamid.ABC123"): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "5994165363",
                  id: messageId,
                  type: "text",
                  text: { body: "Hi" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function signedRequest(body: string, signature?: string): NextRequest {
  const sig =
    signature ??
    `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
  return new NextRequest(
    "https://saba-water-delivery.vercel.app/api/webhooks/whatsapp",
    {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      body,
    },
  );
}

describe("GET /api/webhooks/whatsapp", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    setEnv();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("echoes the challenge for a valid verify token", async () => {
    const url =
      "https://saba-water-delivery.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234";
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1234");
  });

  it("rejects an invalid verify token", async () => {
    const url =
      "https://saba-water-delivery.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234";
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(403);
  });

  it("returns the x-request-id header on a successful verification", async () => {
    const url =
      "https://saba-water-delivery.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=echo-42";
    const response = await GET(
      new NextRequest(url, { headers: { "x-request-id": "get-ok-1" } }),
    );
    // Meta verification semantics unchanged: same status and exact challenge
    // body, now with the boundary's correlation header added.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("echo-42");
    expect(response.headers.get("x-request-id")).toBe("get-ok-1");
  });

  it("normalizes an unexpected GET failure safely with the request id in header and body", async () => {
    const spy = vi
      .spyOn(whatsappClient, "verifyWhatsAppWebhookChallenge")
      .mockImplementation(() => {
        // A genuine unexpected fault whose message carries a secret-shaped
        // value, to prove nothing sensitive leaks to the client or logs.
        throw new Error("upstream failure with Bearer super-secret-token");
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const url =
      "https://saba-water-delivery.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234";
    const response = await GET(
      new NextRequest(url, { headers: { "x-request-id": "get-err-1" } }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("get-err-1");

    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).toBe("get-err-1");
    expect(body.error).toBe(
      "An unexpected error occurred. Please try again later.",
    );

    // No secret/token value leaks in the response...
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("super-secret-token");
    expect(bodyStr).not.toContain("verify-me");

    // ...nor in the boundary's redacted log output.
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("api.webhooks.whatsapp.unhandled_error");
    expect(logged).not.toContain("super-secret-token");

    spy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("POST /api/webhooks/whatsapp", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    setEnv();
    claimMessageIdMock.mockReset();
    handleIncomingMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a request with an invalid signature", async () => {
    const body = messagePayload();
    const response = await POST(
      signedRequest(
        body,
        "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    );
    expect(response.status).toBe(401);
    expect(claimMessageIdMock).not.toHaveBeenCalled();
    expect(handleIncomingMock).not.toHaveBeenCalled();
  });

  it("processes a new message exactly once", async () => {
    claimMessageIdMock.mockResolvedValue(true);
    const body = messagePayload("wamid.NEW1");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(claimMessageIdMock).toHaveBeenCalledWith("wamid.NEW1");
    expect(handleIncomingMock).toHaveBeenCalledTimes(1);
    expect(handleIncomingMock).toHaveBeenCalledWith("5994165363", "Hi");
  });

  it("skips processing when the same message ID was already claimed (Meta retry)", async () => {
    claimMessageIdMock.mockResolvedValue(false); // already processed
    const body = messagePayload("wamid.DUP1");
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(claimMessageIdMock).toHaveBeenCalledWith("wamid.DUP1");
    expect(handleIncomingMock).not.toHaveBeenCalled();
  });

  it("never advances the conversation twice for two deliveries of the same message ID", async () => {
    // First delivery claims successfully; the retry (same ID) does not.
    claimMessageIdMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const body = messagePayload("wamid.RETRY1");

    await POST(signedRequest(body));
    await POST(signedRequest(body));

    expect(handleIncomingMock).toHaveBeenCalledTimes(1);
  });
});
