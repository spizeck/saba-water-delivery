import { describe, expect, it, vi } from "vitest";

// `serverConfig.ts` is `server-only`; stub the guard so it can be unit-tested
// under the plain (node) vitest run, matching the repo convention (see
// src/lib/security/__tests__/rateLimit.test.ts).
vi.mock("server-only", () => ({}));

import { ConfigError } from "../errors";
import {
  getDatabaseId,
  getFirebaseAdminConfig,
  getServerConfigStatus,
} from "../serverConfig";

/**
 * Server configuration registry + sanitized status (issue #54). Every scenario
 * passes an explicit env so results never depend on the developer's shell
 * (which may itself contain real configuration). Covers production, preview,
 * local, test, emulator, missing-secret, malformed-value, disabled-integration,
 * partially-configured-integration, and — critically — that no status output or
 * error ever contains a secret value.
 */

const PRIVATE_KEY_VALUE =
  "-----BEGIN PRIVATE KEY-----\\nMIIBVERYSECRET\\n-----END PRIVATE KEY-----\\n";

/** A fully valid deployed Production configuration (all required present). */
function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    FIREBASE_ADMIN_PROJECT_ID: "saba-prod",
    FIREBASE_ADMIN_CLIENT_EMAIL: "svc@saba-prod.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: PRIVATE_KEY_VALUE,
    NEXT_PUBLIC_FIREBASE_API_KEY: "pub-api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "saba-prod.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "saba-prod",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:2:web:3",
    RATE_LIMIT_HASH_SECRET: "rl-hash-secret-value",
    CRON_SECRET: "cron-secret-value",
    ...overrides,
  };
}

const entry = (
  status: ReturnType<typeof getServerConfigStatus>,
  name: string,
) => status.entries.find((e) => e.variable === name);

describe("getServerConfigStatus — valid production", () => {
  it("reports ok with nothing missing or invalid", () => {
    const status = getServerConfigStatus(productionEnv());
    expect(status.target).toBe("production");
    expect(status.isDeployed).toBe(true);
    expect(status.missingRequired).toEqual([]);
    expect(status.invalid).toEqual([]);
    expect(status.ok).toBe(true);
  });
});

describe("getServerConfigStatus — missing required production secret", () => {
  it("flags a missing FIREBASE_ADMIN_PRIVATE_KEY as required-and-missing", () => {
    const status = getServerConfigStatus(
      productionEnv({ FIREBASE_ADMIN_PRIVATE_KEY: undefined }),
    );
    expect(status.ok).toBe(false);
    expect(status.missingRequired).toContain("FIREBASE_ADMIN_PRIVATE_KEY");
    expect(entry(status, "FIREBASE_ADMIN_PRIVATE_KEY")).toMatchObject({
      level: "required",
      status: "unset",
      classification: "secret",
    });
  });

  it("requires RATE_LIMIT_HASH_SECRET in Preview too", () => {
    const status = getServerConfigStatus({
      ...productionEnv(),
      VERCEL_ENV: "preview",
      RATE_LIMIT_HASH_SECRET: undefined,
    });
    expect(status.target).toBe("preview");
    expect(status.missingRequired).toContain("RATE_LIMIT_HASH_SECRET");
  });

  it("requires CRON_SECRET in production but not in preview", () => {
    const prod = getServerConfigStatus(
      productionEnv({ CRON_SECRET: undefined }),
    );
    expect(prod.missingRequired).toContain("CRON_SECRET");

    const preview = getServerConfigStatus({
      ...productionEnv({ CRON_SECRET: undefined }),
      VERCEL_ENV: "preview",
    });
    expect(preview.missingRequired).not.toContain("CRON_SECRET");
    expect(entry(preview, "CRON_SECRET")?.level).toBe("optional");
  });
});

describe("getServerConfigStatus — malformed value", () => {
  it("marks a malformed client email invalid (not merely present)", () => {
    const status = getServerConfigStatus(
      productionEnv({ FIREBASE_ADMIN_CLIENT_EMAIL: "not-an-email" }),
    );
    expect(status.invalid).toContain("FIREBASE_ADMIN_CLIENT_EMAIL");
    expect(status.ok).toBe(false);
    expect(entry(status, "FIREBASE_ADMIN_CLIENT_EMAIL")?.status).toBe(
      "invalid",
    );
  });

  it("marks a malformed FIREBASE_DATABASE_ID invalid", () => {
    const status = getServerConfigStatus(
      productionEnv({ FIREBASE_DATABASE_ID: "Bad_Id!" }),
    );
    expect(status.invalid).toContain("FIREBASE_DATABASE_ID");
  });
});

describe("getServerConfigStatus — optional integrations", () => {
  it("does NOT require WhatsApp or Resend when the integration is absent", () => {
    const status = getServerConfigStatus(productionEnv());
    expect(status.missingRequired).not.toContain("WHATSAPP_ACCESS_TOKEN");
    expect(status.missingRequired).not.toContain("CONTINUITY_REPORT_EMAIL_TO");
    expect(entry(status, "WHATSAPP_ACCESS_TOKEN")?.level).toBe("optional");
    expect(entry(status, "RESEND_API_KEY")?.level).toBe("optional");
    expect(status.ok).toBe(true);
  });

  it("requires the rest of an integration once it is PARTIALLY configured", () => {
    // Resend enabled (API key present) but sender/recipient missing.
    const status = getServerConfigStatus(
      productionEnv({ RESEND_API_KEY: "re_key" }),
    );
    expect(entry(status, "CONTINUITY_REPORT_EMAIL_FROM")?.level).toBe(
      "required",
    );
    expect(entry(status, "CONTINUITY_REPORT_EMAIL_TO")?.level).toBe("required");
    expect(status.missingRequired).toContain("CONTINUITY_REPORT_EMAIL_FROM");
    expect(status.missingRequired).toContain("CONTINUITY_REPORT_EMAIL_TO");
    expect(status.ok).toBe(false);
  });

  it("requires the remaining WhatsApp vars once one is set", () => {
    const status = getServerConfigStatus(
      productionEnv({ WHATSAPP_ACCESS_TOKEN: "tok" }),
    );
    expect(entry(status, "WHATSAPP_APP_SECRET")?.level).toBe("required");
    expect(status.missingRequired).toContain("WHATSAPP_APP_SECRET");
  });
});

describe("getServerConfigStatus — local / test / emulator", () => {
  it("does not require Firebase Admin in local development (recommended, still ok)", () => {
    const status = getServerConfigStatus({ NODE_ENV: "development" });
    expect(status.target).toBe("development");
    expect(entry(status, "FIREBASE_ADMIN_PRIVATE_KEY")?.level).toBe(
      "recommended",
    );
    expect(status.missingRequired).toEqual([]);
    expect(status.ok).toBe(true);
  });

  it("treats Firebase config as optional under emulator mode", () => {
    const status = getServerConfigStatus({
      NODE_ENV: "test",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    expect(status.isEmulator).toBe(true);
    expect(entry(status, "FIREBASE_ADMIN_PROJECT_ID")?.level).toBe("optional");
    expect(status.ok).toBe(true);
  });
});

describe("getServerConfigStatus — never exposes secret values", () => {
  it("contains no configured secret value anywhere in the serialized status", () => {
    const env = productionEnv({
      RESEND_API_KEY: "re_live_TOPSECRET",
      WHATSAPP_ACCESS_TOKEN: "wa-access-TOPSECRET",
      WHATSAPP_PHONE_NUMBER_ID: "12345",
      WHATSAPP_APP_SECRET: "wa-app-TOPSECRET",
      WHATSAPP_VERIFY_TOKEN: "wa-verify-TOPSECRET",
      CONTINUITY_REPORT_EMAIL_FROM: "reports@saba.gov.example",
      CONTINUITY_REPORT_EMAIL_TO: "ops@saba.gov.example",
    });
    const serialized = JSON.stringify(getServerConfigStatus(env));
    for (const secret of [
      PRIVATE_KEY_VALUE,
      "rl-hash-secret-value",
      "cron-secret-value",
      "re_live_TOPSECRET",
      "wa-access-TOPSECRET",
      "wa-app-TOPSECRET",
      "wa-verify-TOPSECRET",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // It DOES contain the (safe) variable names.
    expect(serialized).toContain("RESEND_API_KEY");
    expect(serialized).toContain("FIREBASE_ADMIN_PRIVATE_KEY");
  });
});

describe("getFirebaseAdminConfig / getDatabaseId", () => {
  it("returns validated admin config", () => {
    const cfg = getFirebaseAdminConfig(productionEnv());
    expect(cfg.projectId).toBe("saba-prod");
    expect(cfg.clientEmail).toContain("@");
    expect(cfg.privateKey).toContain("\n"); // unescaped
  });

  it("throws a sanitized ConfigError when the private key is malformed", () => {
    try {
      getFirebaseAdminConfig(
        productionEnv({ FIREBASE_ADMIN_PRIVATE_KEY: "totally-not-a-key" }),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).not.toContain("totally-not-a-key");
    }
  });

  it("resolves and validates the optional database id", () => {
    expect(getDatabaseId({})).toBeUndefined();
    expect(getDatabaseId({ FIREBASE_DATABASE_ID: "recovery-20260912" })).toBe(
      "recovery-20260912",
    );
    expect(() => getDatabaseId({ FIREBASE_DATABASE_ID: "Bad_Id!" })).toThrow(
      ConfigError,
    );
  });
});
