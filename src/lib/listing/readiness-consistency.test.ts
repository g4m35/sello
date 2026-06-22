import { describe, expect, it, vi } from "vitest";

import {
  preflightEbayListing,
  type EbayPreflightPrismaLike,
} from "@/lib/marketplace/adapters/ebay/preflight";

import { evaluateDraftReadiness, type DraftReadinessInput } from "./draft-readiness";

// The listing detail rail, inventory/dashboard counts, and the approve gate all
// run evaluateDraftReadiness; bulk publish preflight and the publish route run
// preflightEbayListing. These tests pin that both reach the SAME item-level
// verdict on the same item, so a draft can never look "ready" on the dashboard
// while bulk publish silently rejects it (the original alpha-smoke mismatch).

const productionEnv = {
  EBAY_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  EBAY_PUBLIC_IMAGE_BUCKET: "ebay-public",
};

const derivativeUrl =
  "https://project.supabase.co/storage/v1/object/public/ebay-public/ebay/production/item-1/photo-1/derivative.jpg";

// One source item, expressed in the two shapes the two evaluators consume, so
// the test can never drift the inputs apart.
function sourceItem(size: string | null) {
  return {
    id: "item-1",
    sellerId: "user-1",
    brand: "Nike",
    condition: "new_with_tags" as const,
    size,
    colorway: "Aqua",
    productCategory: "sneakers",
    title: "Nike Air Max 1 Patta Waves Noise Aqua",
    description: "Authentic deadstock pair. Ships double-boxed safely.",
    recommendedPriceCents: 24000,
    categoryId: "15709",
  };
}

function draftReadinessInput(size: string | null): DraftReadinessInput {
  const s = sourceItem(size);
  return {
    productName: s.title,
    title: s.title,
    description: s.description,
    bulletPoints: ["Deadstock", "Original box", "Patta Waves"],
    selectedMarketplaces: ["ebay"],
    recommendedPriceCents: s.recommendedPriceCents,
    condition: s.condition,
    productCategory: s.productCategory,
    brand: s.brand,
    size: s.size,
    colorway: s.colorway,
    itemSpecifics: {},
    savedEbayCategoryId: s.categoryId,
    savedAspects: {},
    savedQuantity: 1,
    photoCount: 3,
  };
}

function preflightPrisma(size: string | null): EbayPreflightPrismaLike {
  const s = sourceItem(size);
  return {
    inventoryItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: s.id,
        sellerId: s.sellerId,
        brand: s.brand,
        condition: s.condition,
        size: s.size,
        colorway: s.colorway,
        listingDrafts: [
          {
            title: s.title,
            description: s.description,
            recommendedPriceCents: s.recommendedPriceCents,
            itemSpecifics: {},
            marketplaceDrafts: { ebay: { categoryId: s.categoryId, quantity: 1 } },
          },
        ],
        photos: [
          {
            id: "photo-1",
            inventoryItemId: "item-1",
            storageBucket: "listing-photos",
            storagePath: "user-1/item-1/private-front.jpg",
            mimeType: "image/jpeg",
            originalName: "front.jpg",
            position: 0,
          },
        ],
      }),
    },
    marketplaceConnection: { findUnique: vi.fn().mockResolvedValue({ id: "conn-1" }) },
    ebaySellerConfig: {
      findFirst: vi.fn().mockResolvedValue({
        marketplaceId: "EBAY_US",
        paymentPolicyId: "pay-1",
        fulfillmentPolicyId: "ful-1",
        returnPolicyId: "ret-1",
        merchantLocationKey: "sello-default-location",
      }),
    },
    marketplaceImage: {
      findMany: vi.fn().mockResolvedValue([
        {
          itemPhotoId: "photo-1",
          marketplace: "ebay",
          environment: "production",
          storagePath: "ebay/production/item-1/photo-1/derivative.jpg",
          publicUrl: derivativeUrl,
          status: "READY",
        },
      ]),
      upsert: vi.fn(async ({ create }: { create: unknown }) => create),
    },
  } as unknown as EbayPreflightPrismaLike;
}

describe("readiness consistency across surfaces", () => {
  it("both evaluators reject the same item for a missing size", async () => {
    const view = evaluateDraftReadiness(draftReadinessInput(null));
    const preflight = await preflightEbayListing(
      preflightPrisma(null),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(view.ready).toBe(false);
    expect(view.issues.map((i) => i.code)).toContain("missing_size");

    expect(preflight.ready).toBe(false);
    expect(preflight.missing).toContain("ebay_size");
  });

  it("both evaluators accept the same item once size is present", async () => {
    const view = evaluateDraftReadiness(draftReadinessInput("US 10"));
    const preflight = await preflightEbayListing(
      preflightPrisma("US 10"),
      { userId: "user-1", inventoryItemId: "item-1" },
      productionEnv,
    );

    expect(view.ready).toBe(true);
    expect(preflight.ready).toBe(true);
  });
});
