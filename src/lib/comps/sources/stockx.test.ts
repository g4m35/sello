import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptStockXToken } from "@/lib/marketplace/adapters/stockx/token-crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    marketplaceConnection: { findUnique: mocks.findUnique },
    listingDraft: { update: mocks.update },
  }),
}));

import { stockxSource } from "./stockx";

const key = "a".repeat(64);

function stubStockXEnv() {
  vi.stubEnv("STOCKX_API_ENABLED", "true");
  vi.stubEnv("STOCKX_MARKET_DATA_ENABLED", "true");
  vi.stubEnv("STOCKX_CLIENT_ID", "client-id");
  vi.stubEnv("STOCKX_CLIENT_SECRET", "client-secret");
  vi.stubEnv("STOCKX_API_KEY", "api-key");
  vi.stubEnv("STOCKX_REDIRECT_URI", "https://sello.wtf/api/marketplaces/stockx/callback");
  vi.stubEnv("STOCKX_TOKEN_ENCRYPTION_KEY", key);
}

describe("StockX comp source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "conn-1",
      accountId: "acc-1",
      externalUserId: "stockx|u1",
      accessTokenEnc: encryptStockXToken("access-token", key),
      refreshTokenEnc: encryptStockXToken("refresh-token", key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    mocks.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is paid and fails closed unless every StockX market-data env is present", () => {
    expect(stockxSource.paid).toBe(true);
    expect(stockxSource.isEnabled()).toBe(false);
    stubStockXEnv();
    expect(stockxSource.isEnabled()).toBe(true);
    vi.stubEnv("STOCKX_API_KEY", "");
    expect(stockxSource.isEnabled()).toBe(false);
  });

  it("does nothing without a saved StockX product match", async () => {
    stubStockXEnv();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const comps = await stockxSource.fetchComps({
      accountId: "acc-1",
      draftId: "draft-1",
      styleCode: null,
      brand: "Nike",
      title: "Nike Dunk Low Panda",
      size: "10",
      category: "sneakers",
      keywords: "Nike Dunk Low Panda",
    });

    expect(comps).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is an active-market source (ask/bid levels, not completed sales)", () => {
    stubStockXEnv();
    expect(stockxSource.sold).toBe(false);
    expect(stockxSource.resultKind).toBe("active_listings");
  });

  it("fetches market data through the encrypted account connection", async () => {
    stubStockXEnv();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              productId: "p1",
              variantId: "v1",
              currencyCode: "USD",
              lowestAskAmount: 120,
              highestBidAmount: 95,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const comps = await stockxSource.fetchComps({
      accountId: "acc-1",
      draftId: "draft-1",
      stockxProductId: "p1",
      stockxVariantId: "v1",
      styleCode: null,
      brand: "Nike",
      title: "Nike Dunk Low Panda",
      size: "10",
      category: "sneakers",
      keywords: "Nike Dunk Low Panda",
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_marketplace_environment: {
          accountId: "acc-1",
          marketplace: "stockx",
          environment: "production",
        },
      },
      select: {
        id: true,
        accountId: true,
        externalUserId: true,
        accessTokenEnc: true,
        refreshTokenEnc: true,
        accessTokenExpiresAt: true,
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("currencyCode=USD");
    expect(comps[0]).toMatchObject({
      source: "stockx",
      priceCents: 12000,
      sold: false,
      size: "10",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { stockxMarketDataCheckedAt: expect.any(Date) },
    });
  });

  it("throws a soft not-connected error when the account has no StockX OAuth row", async () => {
    stubStockXEnv();
    mocks.findUnique.mockResolvedValue(null);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      stockxSource.fetchComps({
        accountId: "acc-1",
        draftId: "draft-1",
        stockxProductId: "p1",
        styleCode: null,
        brand: "Nike",
        title: "Nike Dunk Low Panda",
        size: "10",
        category: "sneakers",
        keywords: "Nike Dunk Low Panda",
      }),
    ).rejects.toMatchObject({ code: "stockx_not_connected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
