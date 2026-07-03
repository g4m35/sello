import { describe, expect, it, vi } from "vitest";

import type { ItemCondition } from "@/generated/prisma/client";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import {
  publishStockXListing,
  type StockXPublishClient,
  type StockXPublishPrismaLike,
} from "./publish";

const stockxEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_LISTING_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_API_KEY: "api-key",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

function prisma(overrides: {
  draft?: Partial<DraftRow> | null;
  connection?: { accessTokenEnc: string } | null;
  item?: Partial<ItemRow> | null;
} = {}): StockXPublishPrismaLike {
  const item = overrides.item === null ? null : itemRow(overrides.item);
  const draft =
    overrides.draft === null
      ? null
      : {
          title: "Nike Dunk Low Panda",
          recommendedPriceCents: 12500,
          stockxProductId: "product-1",
          stockxVariantId: "variant-1",
          marketplaceDrafts: {
            stockx: {
              productId: "product-1",
              variantId: "variant-1",
              title: "Nike Dunk Low Panda",
              url: "https://stockx.com/nike-dunk-low-panda",
            },
          },
          ...overrides.draft,
        };

  return {
    inventoryItem: {
      findFirst: vi.fn(async () =>
        item ? { ...item, listingDrafts: draft ? [draft] : [] } : null,
      ),
    },
    marketplaceConnection: {
      findUnique: vi.fn(async () =>
        overrides.connection === null
          ? null
          : {
              id: "conn-1",
              accountId: "acc-1",
              externalUserId: "stockx-user-1",
              // Tests inject resolveAccessToken, so these are never decrypted.
              accessTokenEnc: overrides.connection?.accessTokenEnc ?? "encrypted-access",
              refreshTokenEnc: "encrypted-refresh",
            },
      ),
    },
  };
}

type DraftRow = {
  title: string;
  recommendedPriceCents: number | null;
  stockxProductId: string | null;
  stockxVariantId: string | null;
  marketplaceDrafts: unknown;
};

type ItemRow = {
  id: string;
  sellerId: string;
  accountId: string;
  condition: ItemCondition;
  quantityAvailable: number;
  listingDrafts: DraftRow[];
};

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "item-1",
    sellerId: "user-1",
    accountId: "acc-1",
    condition: "new_with_tags",
    quantityAvailable: 1,
    listingDrafts: [],
    ...overrides,
  };
}

function client(overrides: Partial<StockXPublishClient> = {}): StockXPublishClient {
  return {
    createListing: vi.fn(async () => ({
      listingId: "stockx-listing-1",
      status: "CREATED",
      operationId: null,
      operationStatus: null,
      operationUrl: null,
      rawJson: {},
    })),
    activateListing: vi.fn(async () => ({
      listingId: "stockx-listing-1",
      status: null,
      operationId: "operation-1",
      operationStatus: "PENDING",
      operationUrl:
        "https://api.stockx.com/v2/selling/listings/stockx-listing-1/operations/operation-1",
      rawJson: {},
    })),
    ...overrides,
  };
}

describe("publishStockXListing", () => {
  it("returns not_enabled and performs no DB/token/client work when the listing flag is off", async () => {
    const p = prisma();
    const c = client();

    const result = await publishStockXListing(
      p,
      {
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        confirmLivePublish: true,
      },
      {
        env: { ...stockxEnv, STOCKX_LISTING_ENABLED: "false" },
        resolveAccessToken: vi.fn(),
        createClient: () => c,
      },
    );

    expect(result.status).toBe("not_enabled");
    expect(p.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(c.createListing).not.toHaveBeenCalled();
  });

  it("creates and activates a matched StockX listing with the official amount/variant payload", async () => {
    const c = client();

    const result = await publishStockXListing(
      prisma(),
      {
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        confirmLivePublish: true,
      },
      {
        env: stockxEnv,
        resolveAccessToken: vi.fn(async () => "access-token"),
        createClient: () => c,
      },
    );

    expect(c.createListing).toHaveBeenCalledWith({
      amount: "125.00",
      variantId: "variant-1",
    });
    expect(c.activateListing).toHaveBeenCalledWith("stockx-listing-1");
    expect(result).toMatchObject({
      status: "submitted",
      code: "STOCKX_LISTING_SUBMITTED",
      listingId: "stockx-listing-1",
      operationId: "operation-1",
      operationStatus: "PENDING",
    });
  });

  it("blocks before any client call when the listing is not matched to a StockX variant", async () => {
    const c = client();

    await expect(
      publishStockXListing(
        prisma({
          draft: {
            stockxVariantId: null,
            marketplaceDrafts: { stockx: { productId: "product-1", variantId: null } },
          },
        }),
        {
          userId: "user-1",
          accountId: "acc-1",
          inventoryItemId: "item-1",
          confirmLivePublish: true,
        },
        {
          env: stockxEnv,
          resolveAccessToken: vi.fn(async () => "access-token"),
          createClient: () => c,
        },
      ),
    ).rejects.toMatchObject({
      code: stockxErrorCodes.listingReadinessFailed,
      status: 422,
    });
    expect(c.createListing).not.toHaveBeenCalled();
  });

  it("requires explicit seller confirmation before creating a live StockX listing", async () => {
    await expect(
      publishStockXListing(
        prisma(),
        {
          userId: "user-1",
          accountId: "acc-1",
          inventoryItemId: "item-1",
          confirmLivePublish: false,
        },
        {
          env: stockxEnv,
          resolveAccessToken: vi.fn(async () => "access-token"),
          createClient: () => client(),
        },
      ),
    ).rejects.toBeInstanceOf(StockXIntegrationError);
  });
});
