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

  it("rejects unsupported publish marketplaces", () => {
    expect(() =>
      PublishListingJobSchema.parse({
        inventoryItemId: "00000000-0000-4000-8000-000000000001",
        listingDraftId: "00000000-0000-4000-8000-000000000002",
        marketplaces: ["ebay", "stockx"],
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
