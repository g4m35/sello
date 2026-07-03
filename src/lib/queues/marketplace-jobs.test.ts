import { describe, expect, it } from "vitest";

import {
  InventorySyncJobSchema,
  PublishListingJobSchema,
} from "./marketplace-jobs";

describe("marketplace job payload schemas", () => {
  it("accepts a supported marketplace publish job", () => {
    const payload = PublishListingJobSchema.parse({
      inventoryItemId: "00000000-0000-4000-8000-000000000001",
      listingDraftId: "00000000-0000-4000-8000-000000000002",
      marketplaces: ["ebay", "grailed", "poshmark", "depop", "etsy"],
    });

    expect(payload.marketplaces).toHaveLength(5);
  });

  it("accepts the full-native TikTok Shop channel for publishing", () => {
    const payload = PublishListingJobSchema.parse({
      inventoryItemId: "00000000-0000-4000-8000-000000000001",
      listingDraftId: "00000000-0000-4000-8000-000000000002",
      marketplaces: ["ebay", "tiktok_shop"],
    });

    expect(payload.marketplaces).toContain("tiktok_shop");
  });

  it("fails closed: StockX cannot be background-queued without seller confirmation in the payload", () => {
    expect(() =>
      PublishListingJobSchema.parse({
        inventoryItemId: "00000000-0000-4000-8000-000000000001",
        listingDraftId: "00000000-0000-4000-8000-000000000002",
        marketplaces: ["ebay", "stockx"],
      }),
    ).toThrow();
  });

  it("accepts StockX background publish when explicit seller confirmation is present", () => {
    const payload = PublishListingJobSchema.parse({
      inventoryItemId: "00000000-0000-4000-8000-000000000001",
      listingDraftId: "00000000-0000-4000-8000-000000000002",
      marketplaces: ["ebay", "stockx"],
      confirmLivePublish: true,
    });

    expect(payload.marketplaces).toContain("stockx");
  });

  it("fails closed: gated scaffold channels (Vinted) cannot be enqueued for publishing", () => {
    expect(() =>
      PublishListingJobSchema.parse({
        inventoryItemId: "00000000-0000-4000-8000-000000000001",
        listingDraftId: "00000000-0000-4000-8000-000000000002",
        marketplaces: ["vinted"],
      }),
    ).toThrow();
  });

  it("accepts an inventory sync job for a sold listing", () => {
    const payload = InventorySyncJobSchema.parse({
      inventoryItemId: "00000000-0000-4000-8000-000000000001",
      soldMarketplace: "depop",
      soldExternalListingId: "depop-123",
    });

    expect(payload.soldMarketplace).toBe("depop");
  });
});
