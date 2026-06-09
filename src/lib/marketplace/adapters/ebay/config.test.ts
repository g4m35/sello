import { describe, expect, it } from "vitest";

import {
  getEbayConfig,
  getEbayEnvironment,
  getEbayOAuthStateSecret,
  isEbaySandboxPublishEnabled,
} from "./config";
import { ebayErrorCodes } from "./errors";

const completeEnv = {
  EBAY_ENV: "sandbox",
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_REDIRECT_URI_NAME: "redirect-uri-name",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_TOKEN_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

describe("getEbayConfig", () => {
  it("parses sandbox-only eBay config lazily", () => {
    expect(getEbayConfig(completeEnv)).toMatchObject({
      environment: "sandbox",
      marketplaceId: "EBAY_US",
      clientId: "client-id",
      redirectUriName: "redirect-uri-name",
    });
  });

  it("accepts production mode with complete config", () => {
    expect(getEbayConfig({ ...completeEnv, EBAY_ENV: "production" })).toMatchObject({
      environment: "production",
      marketplaceId: "EBAY_US",
    });
  });

  it("rejects unknown EBAY_ENV values", () => {
    expect(() =>
      getEbayConfig({ ...completeEnv, EBAY_ENV: "staging" }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });

  it("fails safely when required eBay env is missing", () => {
    expect(() =>
      getEbayConfig({ ...completeEnv, EBAY_CLIENT_SECRET: "" }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });

  it("does not require EBAY_OAUTH_STATE_SECRET (config is independent of it)", () => {
    // completeEnv has no EBAY_OAUTH_STATE_SECRET, yet getEbayConfig succeeds.
    expect(() => getEbayConfig(completeEnv)).not.toThrow();
    expect(getEbayConfig(completeEnv).tokenEncryptionKey).toBe(
      completeEnv.EBAY_TOKEN_ENCRYPTION_KEY,
    );
  });
});

describe("getEbayEnvironment", () => {
  it("defaults to sandbox and never requires credentials", () => {
    expect(getEbayEnvironment({})).toBe("sandbox");
  });

  it("resolves production without requiring credentials", () => {
    expect(getEbayEnvironment({ EBAY_ENV: "production" })).toBe("production");
  });

  it("rejects unknown values", () => {
    expect(() => getEbayEnvironment({ EBAY_ENV: "prod" })).toThrow(
      expect.objectContaining({ code: ebayErrorCodes.notConfigured }),
    );
  });
});

describe("getEbayOAuthStateSecret", () => {
  const strongSecret = "this-is-a-sufficiently-long-state-secret-value";

  it("fails when the secret is missing", () => {
    expect(() => getEbayOAuthStateSecret({})).toThrow(
      expect.objectContaining({ code: ebayErrorCodes.notConfigured }),
    );
  });

  it("fails when the secret is shorter than 32 bytes", () => {
    expect(() =>
      getEbayOAuthStateSecret({ EBAY_OAUTH_STATE_SECRET: "too-short" }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });

  it("fails on an unfilled placeholder value", () => {
    expect(() =>
      getEbayOAuthStateSecret({
        EBAY_OAUTH_STATE_SECRET: "[EBAY_OAUTH_STATE_SECRET]",
      }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });

  it("returns a sufficiently strong secret", () => {
    expect(
      getEbayOAuthStateSecret({ EBAY_OAUTH_STATE_SECRET: strongSecret }),
    ).toBe(strongSecret);
  });

  it("is independent of the token encryption key", () => {
    // A valid state secret works even when no token encryption key is present.
    expect(
      getEbayOAuthStateSecret({ EBAY_OAUTH_STATE_SECRET: strongSecret }),
    ).toBe(strongSecret);
  });
});

describe("isEbaySandboxPublishEnabled", () => {
  it("defaults to false when the flag is missing", () => {
    expect(isEbaySandboxPublishEnabled({})).toBe(false);
  });

  it("is false when the flag is not exactly 'true'", () => {
    expect(isEbaySandboxPublishEnabled({ EBAY_SANDBOX_PUBLISH_ENABLED: "false" })).toBe(false);
    expect(isEbaySandboxPublishEnabled({ EBAY_SANDBOX_PUBLISH_ENABLED: "TRUE" })).toBe(false);
    expect(isEbaySandboxPublishEnabled({ EBAY_SANDBOX_PUBLISH_ENABLED: "1" })).toBe(false);
    expect(isEbaySandboxPublishEnabled({ EBAY_SANDBOX_PUBLISH_ENABLED: " true " })).toBe(false);
  });

  it("is true only when the flag is exactly 'true'", () => {
    expect(isEbaySandboxPublishEnabled({ EBAY_SANDBOX_PUBLISH_ENABLED: "true" })).toBe(true);
  });
});
