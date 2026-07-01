import { describe, expect, it } from "vitest";

import {
  getStockXApiConfig,
  getStockXMarketDataConfig,
  getStockXOAuthConfig,
  getStockXOAuthStateSecret,
  isStockXApiEnabled,
  isStockXListingEnabled,
  isStockXMarketDataEnabled,
} from "./config";
import { StockXIntegrationError, stockxErrorCodes } from "./errors";

const fullEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_MARKET_DATA_ENABLED: "true",
  STOCKX_LISTING_ENABLED: "false",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_API_KEY: "api-key",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

describe("StockX config flags", () => {
  it("only exact true enables live StockX behavior", () => {
    expect(isStockXApiEnabled({ STOCKX_API_ENABLED: "true" })).toBe(true);
    expect(isStockXApiEnabled({ STOCKX_API_ENABLED: "TRUE" })).toBe(false);
    expect(isStockXMarketDataEnabled({ STOCKX_MARKET_DATA_ENABLED: "true" })).toBe(true);
    expect(isStockXMarketDataEnabled({})).toBe(false);
    expect(isStockXListingEnabled({ STOCKX_LISTING_ENABLED: "true" })).toBe(true);
    expect(isStockXListingEnabled({ STOCKX_LISTING_ENABLED: "1" })).toBe(false);
  });
});

describe("getStockXOAuthConfig", () => {
  it("fails closed when the API switch is off", () => {
    try {
      getStockXOAuthConfig({ ...fullEnv, STOCKX_API_ENABLED: "false" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StockXIntegrationError);
      expect((error as StockXIntegrationError).code).toBe(stockxErrorCodes.notEnabled);
    }
  });

  it("requires OAuth credentials and token encryption key", () => {
    for (const variable of [
      "STOCKX_CLIENT_ID",
      "STOCKX_CLIENT_SECRET",
      "STOCKX_REDIRECT_URI",
      "STOCKX_TOKEN_ENCRYPTION_KEY",
    ]) {
      expect(() => getStockXOAuthConfig({ ...fullEnv, [variable]: undefined })).toThrow(
        StockXIntegrationError,
      );
    }
  });

  it("uses safe production defaults", () => {
    const config = getStockXOAuthConfig({
      ...fullEnv,
      STOCKX_API_BASE_URL: undefined,
      STOCKX_AUTH_BASE_URL: undefined,
      STOCKX_SCOPES: undefined,
    });
    expect(config.apiBaseUrl).toBe("https://api.stockx.com/v2");
    expect(config.authBaseUrl).toBe("https://accounts.stockx.com");
    expect(config.scopes).toEqual(["offline_access", "openid"]);
  });
});

describe("StockX API and market-data config", () => {
  it("requires the API key for API calls but not OAuth config", () => {
    expect(getStockXOAuthConfig({ ...fullEnv, STOCKX_API_KEY: undefined }).apiKey).toBeNull();
    expect(() => getStockXApiConfig({ ...fullEnv, STOCKX_API_KEY: undefined })).toThrow(
      StockXIntegrationError,
    );
  });

  it("keeps market data behind its own switch", () => {
    expect(() =>
      getStockXMarketDataConfig({ ...fullEnv, STOCKX_MARKET_DATA_ENABLED: "false" }),
    ).toThrow(StockXIntegrationError);
  });
});

describe("getStockXOAuthStateSecret", () => {
  it("requires a non-placeholder state secret of at least 32 bytes", () => {
    expect(() => getStockXOAuthStateSecret({ STOCKX_OAUTH_STATE_SECRET: "short" })).toThrow(
      StockXIntegrationError,
    );
    expect(getStockXOAuthStateSecret({ STOCKX_OAUTH_STATE_SECRET: "x".repeat(32) })).toBe(
      "x".repeat(32),
    );
  });
});
