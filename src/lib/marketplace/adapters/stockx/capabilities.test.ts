import { describe, expect, it } from "vitest";

import {
  isStockXListingCreationAvailable,
  resolveStockXCapabilities,
} from "./capabilities";

const oauthEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

describe("StockX capability resolution", () => {
  it("does not expose connect or catalog capability from the API flag alone", () => {
    expect(resolveStockXCapabilities({ STOCKX_API_ENABLED: "true" })).toEqual({
      connect: false,
      catalogSearch: false,
      productMatching: true,
      marketData: false,
      listingCreation: false,
      listingSync: false,
      orderSync: false,
    });
  });

  it("allows OAuth connection without claiming catalog or market-data readiness", () => {
    expect(resolveStockXCapabilities(oauthEnv)).toMatchObject({
      connect: true,
      catalogSearch: false,
      marketData: false,
      listingCreation: false,
    });
  });

  it("requires full API readiness before catalog and market data are exposed", () => {
    expect(
      resolveStockXCapabilities({
        ...oauthEnv,
        STOCKX_API_KEY: "api-key",
        STOCKX_MARKET_DATA_ENABLED: "true",
      }),
    ).toMatchObject({
      connect: true,
      catalogSearch: true,
      marketData: true,
      listingCreation: false,
    });
  });

  it("keeps listing creation behind both full API readiness and the listing flag", () => {
    expect(
      isStockXListingCreationAvailable({
        ...oauthEnv,
        STOCKX_LISTING_ENABLED: "true",
      }),
    ).toBe(false);
    expect(
      isStockXListingCreationAvailable({
        ...oauthEnv,
        STOCKX_API_KEY: "api-key",
        STOCKX_LISTING_ENABLED: "true",
      }),
    ).toBe(true);
  });
});
