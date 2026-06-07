import { describe, expect, it, vi } from "vitest";

import { publishEbayListing } from "./publish";
import type { EbayPublishPrismaLike, EbayPublishDeps } from "./publish";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const enabledEnv = {
  EBAY_ENV: "sandbox",
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_REDIRECT_URI_NAME: "redirect-uri-name",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_TOKEN_ENCRYPTION_KEY: key,
  EBAY_SANDBOX_PUBLISH_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
};

function readyItem() {
  return {
    id: "item-1",
    sellerId: "user-1",
    brand: "Nike",
    condition: "new_with_tags" as const,
    size: "US 10",
    colorway: "Aqua",
    listingDrafts: [
      {
        title: "Nike Air Max 1 Patta Waves Noise Aqua",
        description: "Authentic deadstock pair. Ships double-boxed safely.",
        recommendedPriceCents: 24000,
        itemSpecifics: {},
        marketplaceDrafts: { ebay: { categoryId: "15709", quantity: 1 } },
      },
    ],
    photos: [{ storageBucket: "b", storagePath: "p1.jpg" }],
  };
}

function connectionRow() {
  return {
    id: "conn-1",
    userId: "user-1",
    accessTokenEnc: "enc-access",
    refreshTokenEnc: "enc-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    scopes: [],
  };
}

function sellerConfigRow() {
  return {
    marketplaceId: "EBAY_US",
    paymentPolicyId: "pay-1",
    fulfillmentPolicyId: "ful-1",
    returnPolicyId: "ret-1",
    merchantLocationKey: "loc-1",
  };
}

function createPrisma(overrides?: {
  item?: unknown;
  connection?: unknown;
  sellerConfig?: unknown;
}): EbayPublishPrismaLike {
  return {
    inventoryItem: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides && "item" in overrides ? overrides.item : readyItem(),
        ),
    },
    marketplaceConnection: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          overrides && "connection" in overrides
            ? overrides.connection
            : connectionRow(),
        ),
      update: vi.fn().mockResolvedValue({}),
    },
    ebaySellerConfig: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides && "sellerConfig" in overrides
            ? overrides.sellerConfig
            : sellerConfigRow(),
        ),
    },
  } as unknown as EbayPublishPrismaLike;
}

function createDeps(): EbayPublishDeps {
  return {
    env: enabledEnv,
    resolveAccessToken: vi.fn().mockResolvedValue("usable-access-token"),
    createClient: vi.fn().mockReturnValue({
      createOrReplaceInventoryItem: vi.fn().mockResolvedValue(undefined),
      createOffer: vi.fn().mockResolvedValue({ offerId: "offer-1" }),
      publishOffer: vi.fn().mockResolvedValue({ listingId: "listing-1" }),
    }),
  };
}

describe("publishEbayListing — guard", () => {
  it("returns EBAY_PUBLISH_NOT_ENABLED and makes zero eBay calls when the flag is off", async () => {
    const prisma = createPrisma();
    const deps = createDeps();
    deps.env = { ...enabledEnv, EBAY_SANDBOX_PUBLISH_ENABLED: "false" };

    const result = await publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps);

    expect(result.status).toBe("not_enabled");
    expect(result.code).toBe("EBAY_PUBLISH_NOT_ENABLED");
    expect(deps.resolveAccessToken).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("defaults to blocked when the flag is missing entirely", async () => {
    const prisma = createPrisma();
    const deps = createDeps();
    deps.env = {
      EBAY_ENV: "sandbox",
      EBAY_CLIENT_ID: "client-id",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_REDIRECT_URI_NAME: "redirect-uri-name",
      EBAY_TOKEN_ENCRYPTION_KEY: key,
    };

    const result = await publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps);

    expect(result.code).toBe("EBAY_PUBLISH_NOT_ENABLED");
    expect(deps.createClient).not.toHaveBeenCalled();
  });
});

describe("publishEbayListing — preconditions", () => {
  it("throws EBAY_NOT_CONNECTED when there is no connection (flag on)", async () => {
    const prisma = createPrisma({ connection: null });
    const deps = createDeps();

    await expect(
      publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps),
    ).rejects.toMatchObject({ code: "EBAY_NOT_CONNECTED" });
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("throws 404 when the item is not owned by the user", async () => {
    const prisma = createPrisma({ item: null });
    const deps = createDeps();

    await expect(
      publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps),
    ).rejects.toMatchObject({ status: 404 });
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("throws EBAY_READINESS_FAILED and makes zero eBay calls when not ready", async () => {
    const prisma = createPrisma({ sellerConfig: null });
    const deps = createDeps();

    await expect(
      publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps),
    ).rejects.toMatchObject({ code: "EBAY_READINESS_FAILED" });
    expect(deps.resolveAccessToken).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });
});

describe("publishEbayListing — happy path", () => {
  it("runs inventory→offer→publish and returns sku/offerId/listingId", async () => {
    const prisma = createPrisma();
    const deps = createDeps();

    const result = await publishEbayListing(prisma, { userId: "user-1", inventoryItemId: "item-1" }, deps);

    expect(result.status).toBe("published");
    if (result.status !== "published") throw new Error("expected published result");
    expect(result.sku).toBe("percs_item-1");
    expect(result.offerId).toBe("offer-1");
    expect(result.listingId).toBe("listing-1");

    const client = (deps.createClient as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(client.createOrReplaceInventoryItem).toHaveBeenCalledOnce();
    expect(client.createOffer).toHaveBeenCalledOnce();
    expect(client.publishOffer).toHaveBeenCalledWith("offer-1");
  });
});
