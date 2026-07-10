import { describe, expect, it, vi } from "vitest";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import {
  connectionReadiness,
  probeStockXConnectionReadiness,
  stockxConnectionStatusLabel,
} from "./connection-readiness";

const oauthEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_MARKET_DATA_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
  STOCKX_API_KEY: "api-key",
};

vi.mock("./session", () => ({
  loadStockXConnectionSession: vi.fn(),
}));

vi.mock("./client", () => ({
  searchStockXCatalog: vi.fn(),
  fetchStockXMarketData: vi.fn(),
}));

import { fetchStockXMarketData, searchStockXCatalog } from "./client";
import { loadStockXConnectionSession } from "./session";

describe("stockxConnectionStatusLabel", () => {
  it("maps setup states to short seller status lines", () => {
    expect(stockxConnectionStatusLabel({ setupState: "not_connected" })).toBe(
      "Not connected",
    );
    expect(
      stockxConnectionStatusLabel({ setupState: "seller_profile_incomplete" }),
    ).toBe("Connected · finish setup");
    expect(stockxConnectionStatusLabel({ setupState: "ready" })).toBe(
      "Connected · ready",
    );
  });
});

describe("connectionReadiness helper", () => {
  it("builds next-step copy for incomplete seller profile", () => {
    const result = connectionReadiness("seller_profile_incomplete");
    expect(result.connected).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.sellerProfileIncomplete).toBe(true);
    expect(result.nextStep?.externalUrl).toContain("stockx.com");
  });
});

describe("probeStockXConnectionReadiness", () => {
  it("returns not_connected when OAuth is not configured", async () => {
    const result = await probeStockXConnectionReadiness({
      prisma: {} as never,
      accountId: "acc-1",
      env: {},
    });
    expect(result.setupState).toBe("not_connected");
  });

  it("returns seller_profile_incomplete when market-data requires billing/shipping", async () => {
    vi.mocked(loadStockXConnectionSession).mockResolvedValue({
      connection: {
        id: "c1",
        accountId: "acc-1",
        externalUserId: "sx",
        accessTokenEnc: "x",
        refreshTokenEnc: "y",
      },
      accessToken: "token",
    });
    vi.mocked(searchStockXCatalog).mockResolvedValue([
      {
        productId: "p1",
        variantId: null,
        title: "Nike Dunk",
        brand: "Nike",
        model: null,
        style: null,
        colorway: null,
        color: null,
        size: null,
        image: null,
        category: null,
        url: null,
      },
    ]);
    vi.mocked(fetchStockXMarketData).mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.sellerProfileIncomplete,
        "Finish billing and shipping setup on StockX before using market data.",
        409,
      ),
    );

    const result = await probeStockXConnectionReadiness({
      prisma: {} as never,
      accountId: "acc-1",
      env: oauthEnv,
    });

    expect(result.setupState).toBe("seller_profile_incomplete");
    expect(result.nextStep?.message).toMatch(/billing and shipping/i);
  });

  it("returns ready when market-data probe succeeds", async () => {
    vi.mocked(loadStockXConnectionSession).mockResolvedValue({
      connection: {
        id: "c1",
        accountId: "acc-1",
        externalUserId: "sx",
        accessTokenEnc: "x",
        refreshTokenEnc: "y",
      },
      accessToken: "token",
    });
    vi.mocked(searchStockXCatalog).mockResolvedValue([
      {
        productId: "p1",
        variantId: null,
        title: "Nike Dunk",
        brand: "Nike",
        model: null,
        style: null,
        colorway: null,
        color: null,
        size: null,
        image: null,
        category: null,
        url: null,
      },
    ]);
    vi.mocked(fetchStockXMarketData).mockResolvedValue([]);

    const result = await probeStockXConnectionReadiness({
      prisma: {} as never,
      accountId: "acc-1",
      env: oauthEnv,
    });

    expect(result.setupState).toBe("ready");
    expect(result.nextStep).toBeNull();
  });
});
