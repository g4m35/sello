import { describe, expect, it, vi } from "vitest";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import {
  delistStockXListing,
  type StockXDelistClient,
  type StockXDelistPrismaLike,
} from "./delist";

const stockxEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_API_KEY: "api-key",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

function prisma(overrides: { connection?: boolean; item?: boolean } = {}): StockXDelistPrismaLike {
  return {
    inventoryItem: {
      findFirst: vi.fn(async () =>
        overrides.item === false ? null : { id: "item-1" },
      ),
    },
    marketplaceConnection: {
      findUnique: vi.fn(async () =>
        overrides.connection === false
          ? null
          : {
              id: "conn-1",
              accountId: "acc-1",
              accessTokenEnc: "encrypted-access",
              refreshTokenEnc: "encrypted-refresh",
            },
      ),
    },
  };
}

function client(overrides: Partial<StockXDelistClient> = {}): StockXDelistClient {
  return {
    deactivateListing: vi.fn(async () => ({
      listingId: "stockx-listing-1",
      status: null,
      operationId: "operation-2",
      operationStatus: "PENDING",
      operationUrl: "https://api.stockx.com/v2/selling/listings/stockx-listing-1/operations/operation-2",
      rawJson: {},
    })),
    deleteListing: vi.fn(async () => ({
      listingId: "stockx-listing-1",
      status: "DELETED",
      operationId: null,
      operationStatus: null,
      operationUrl: null,
      rawJson: {},
    })),
    ...overrides,
  };
}

describe("delistStockXListing", () => {
  it("deactivates a stored StockX listing with the account-scoped token", async () => {
    const c = client();

    const result = await delistStockXListing(
      prisma(),
      {
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        listingId: "stockx-listing-1",
      },
      {
        env: stockxEnv,
        resolveAccessToken: vi.fn(async () => "access-token"),
        createClient: () => c,
      },
    );

    expect(c.deactivateListing).toHaveBeenCalledWith("stockx-listing-1");
    expect(c.deleteListing).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "delisted",
      code: stockxErrorCodes.delistSucceeded,
      listingId: "stockx-listing-1",
      operationId: "operation-2",
    });
  });

  it("deletes a StockX listing when deactivate is rejected for the current listing state", async () => {
    const c = client({
      deactivateListing: vi.fn(async () => {
        throw new StockXIntegrationError(
          stockxErrorCodes.delistFailed,
          "StockX API request failed.",
          502,
          { status: 400 },
        );
      }),
    });

    const result = await delistStockXListing(
      prisma(),
      {
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        listingId: "stockx-listing-1",
      },
      {
        env: stockxEnv,
        resolveAccessToken: vi.fn(async () => "access-token"),
        createClient: () => c,
      },
    );

    expect(c.deactivateListing).toHaveBeenCalledWith("stockx-listing-1");
    expect(c.deleteListing).toHaveBeenCalledWith("stockx-listing-1");
    expect(result).toMatchObject({
      status: "delisted",
      code: stockxErrorCodes.delistSucceeded,
      listingId: "stockx-listing-1",
    });
  });

  it("blocks before any provider call when StockX is not connected", async () => {
    const c = client();

    await expect(
      delistStockXListing(
        prisma({ connection: false }),
        {
          userId: "user-1",
          accountId: "acc-1",
          inventoryItemId: "item-1",
          listingId: "stockx-listing-1",
        },
        {
          env: stockxEnv,
          resolveAccessToken: vi.fn(async () => "access-token"),
          createClient: () => c,
        },
      ),
    ).rejects.toMatchObject({
      code: stockxErrorCodes.notConnected,
      status: 422,
    });
    expect(c.deactivateListing).not.toHaveBeenCalled();
    expect(c.deleteListing).not.toHaveBeenCalled();
  });

  it("fails closed when StockX API config is missing", async () => {
    await expect(
      delistStockXListing(
        prisma(),
        {
          userId: "user-1",
          accountId: "acc-1",
          inventoryItemId: "item-1",
          listingId: "stockx-listing-1",
        },
        {
          env: { ...stockxEnv, STOCKX_API_KEY: undefined },
          resolveAccessToken: vi.fn(async () => "access-token"),
          createClient: () => client(),
        },
      ),
    ).rejects.toBeInstanceOf(StockXIntegrationError);
  });
});
