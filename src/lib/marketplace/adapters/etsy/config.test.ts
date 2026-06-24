import { describe, expect, it } from "vitest";

import {
  getEtsyConfig,
  getEtsyOAuthStateSecret,
  isEtsyApiEnabled,
} from "./config";
import { EtsyIntegrationError, etsyErrorCodes } from "./errors";

const fullEnv = {
  ETSY_API_ENABLED: "true",
  ETSY_CLIENT_ID: "etsy-keystring",
  ETSY_CLIENT_SECRET: "secret",
  ETSY_REDIRECT_URI: "https://sello.wtf/api/marketplaces/etsy/callback",
  ETSY_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  ETSY_OAUTH_STATE_SECRET: "x".repeat(32),
};

describe("isEtsyApiEnabled", () => {
  it("only the exact string 'true' enables the API", () => {
    expect(isEtsyApiEnabled({ ETSY_API_ENABLED: "true" })).toBe(true);
    expect(isEtsyApiEnabled({ ETSY_API_ENABLED: "TRUE" })).toBe(false);
    expect(isEtsyApiEnabled({ ETSY_API_ENABLED: "1" })).toBe(false);
    expect(isEtsyApiEnabled({})).toBe(false);
  });
});

describe("getEtsyConfig (fail-closed)", () => {
  it("throws notEnabled when the API switch is off", () => {
    try {
      getEtsyConfig({ ...fullEnv, ETSY_API_ENABLED: "false" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EtsyIntegrationError);
      expect((error as EtsyIntegrationError).code).toBe(etsyErrorCodes.notEnabled);
      expect((error as EtsyIntegrationError).status).toBe(503);
    }
  });

  it("throws notConfigured when a required variable is missing or a placeholder", () => {
    for (const variable of [
      "ETSY_CLIENT_ID",
      "ETSY_REDIRECT_URI",
      "ETSY_TOKEN_ENCRYPTION_KEY",
    ]) {
      expect(() => getEtsyConfig({ ...fullEnv, [variable]: undefined })).toThrow(
        EtsyIntegrationError,
      );
      expect(() => getEtsyConfig({ ...fullEnv, [variable]: "[set me]" })).toThrow(
        EtsyIntegrationError,
      );
    }
  });

  it("applies safe defaults for base URL and scopes when omitted", () => {
    const config = getEtsyConfig({
      ...fullEnv,
      ETSY_API_BASE_URL: undefined,
      ETSY_SCOPES: undefined,
      ETSY_CLIENT_SECRET: undefined,
    });
    expect(config.apiBaseUrl).toBe("https://api.etsy.com/v3/application");
    expect(config.scopes).toContain("listings_w");
    expect(config.scopes).toContain("listings_d");
    // PKCE public apps need no secret; it stays null rather than blocking config.
    expect(config.clientSecret).toBeNull();
  });

  it("parses a custom space- or comma-separated scope list", () => {
    const config = getEtsyConfig({ ...fullEnv, ETSY_SCOPES: "listings_r, listings_w" });
    expect(config.scopes).toEqual(["listings_r", "listings_w"]);
  });
});

describe("getEtsyOAuthStateSecret", () => {
  it("requires a non-placeholder secret of at least 32 bytes", () => {
    expect(() => getEtsyOAuthStateSecret({ ETSY_OAUTH_STATE_SECRET: "short" })).toThrow(
      EtsyIntegrationError,
    );
    expect(() => getEtsyOAuthStateSecret({ ETSY_OAUTH_STATE_SECRET: undefined })).toThrow(
      EtsyIntegrationError,
    );
    expect(getEtsyOAuthStateSecret({ ETSY_OAUTH_STATE_SECRET: "x".repeat(32) })).toBe(
      "x".repeat(32),
    );
  });
});
