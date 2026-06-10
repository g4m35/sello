import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preflightEbayListing,
  type EbayPreflightPrismaLike,
} from "./preflight";

const productionEnv = {
  EBAY_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  // Deliberately set: the sandbox flag must never enable anything in production.
  EBAY_SANDBOX_PUBLISH_ENABLED: "true",
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

function createPrisma(overrides?: {
  item?: unknown;
  connection?: unknown;
  sellerConfig?: unknown;
}): EbayPreflightPrismaLike {
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
            : { id: "conn-1" },
        ),
    },
    ebaySellerConfig: {
      findFirst: vi.fn().mockResolvedValue(
        overrides && "sellerConfig" in overrides
          ? overrides.sellerConfig
          : {
              marketplaceId: "EBAY_US",
              paymentPolicyId: "pay-1",
              fulfillmentPolicyId: "ful-1",
              returnPolicyId: "ret-1",
              merchantLocationKey: "sello-default-location",
            },
      ),
    },
  } as unknown as EbayPreflightPrismaLike;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preflightEbayListing", () => {
  it("makes zero outbound network calls, even for a fully ready listing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await preflightEbayListing(
      createPrisma(),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(result.ready).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports production publishing as disabled regardless of the sandbox flag", async () => {
    const result = await preflightEbayListing(
      createPrisma(),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(result.environment).toBe("production");
    expect(result.mode).toBe("dry_run");
    expect(result.publishingEnabled).toBe(false);
  });

  it("produces the exact payload preview for a valid listing", async () => {
    const result = await preflightEbayListing(
      createPrisma(),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(result.preview).not.toBeNull();
    expect(result.preview!.sku).toBe("percs_item-1");
    expect(result.preview!.steps).toEqual([
      "createOrReplaceInventoryItem",
      "createOffer",
      "publishOffer",
    ]);
    expect(result.preview!.inventoryItem).toMatchObject({
      condition: "NEW_WITH_TAGS",
      product: {
        title: "Nike Air Max 1 Patta Waves Noise Aqua",
        aspects: { Brand: ["Nike"], Size: ["US 10"] },
        imageUrls: [
          "https://project.supabase.co/storage/v1/object/public/b/p1.jpg",
        ],
      },
    });
    expect(result.preview!.offer).toMatchObject({
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      categoryId: "15709",
      pricingSummary: { price: { value: "240.00", currency: "USD" } },
      merchantLocationKey: "sello-default-location",
    });
  });

  it("reports missing fields clearly instead of failing", async () => {
    const item = {
      ...readyItem(),
      condition: "unknown" as const,
      listingDrafts: [
        {
          title: null,
          description: null,
          recommendedPriceCents: null,
          itemSpecifics: {},
          marketplaceDrafts: {},
        },
      ],
      photos: [],
    };

    const result = await preflightEbayListing(
      createPrisma({ item }),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(result.ready).toBe(false);
    expect(result.preview).toBeNull();
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "price",
        "condition",
        "categoryId",
        "photo",
      ]),
    );
  });

  it("reports a missing eBay connection and seller config as blockers", async () => {
    const result = await preflightEbayListing(
      createPrisma({ connection: null, sellerConfig: null }),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(result.connected).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(["ebay_connection", "seller_config"]),
    );
  });

  it("requires no eBay credentials, only EBAY_ENV", async () => {
    await expect(
      preflightEbayListing(
        createPrisma(),
        { userId: "user-1", inventoryItemId: "item-1" },
        { EBAY_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co" },
      ),
    ).resolves.toMatchObject({ ready: true });
  });

  it("404s for items the user does not own", async () => {
    await expect(
      preflightEbayListing(
        createPrisma({ item: null }),
        { userId: "user-2", inventoryItemId: "item-1" },
        productionEnv,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reflects the sandbox publish flag only in sandbox", async () => {
    const sandboxEnv = {
      EBAY_ENV: "sandbox",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      EBAY_SANDBOX_PUBLISH_ENABLED: "true",
    };

    const result = await preflightEbayListing(
      createPrisma(),
      { userId: "user-1", inventoryItemId: "item-1" },
      sandboxEnv,
    );

    expect(result.environment).toBe("sandbox");
    expect(result.publishingEnabled).toBe(true);
  });
});
