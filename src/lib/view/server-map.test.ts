import { afterEach, describe, expect, it, vi } from "vitest";

import { mapItem } from "./server-map";

function item() {
  const now = new Date("2026-06-11T12:00:00Z");
  return {
    id: "item-1",
    sellerId: "user-1",
    status: "APPROVED" as const,
    productName: "Nike Air Max 1",
    brand: "Nike",
    category: "sneakers" as const,
    condition: "new_with_tags" as const,
    styleCode: null,
    colorway: "Aqua",
    size: "US 10",
    confidence: null,
    recommendedPriceCents: 24000,
    pricingRationale: null,
    soldAt: null,
    createdAt: now,
    updatedAt: now,
    listingDrafts: [
      {
        id: "draft-1",
        inventoryItemId: "item-1",
        status: "APPROVED" as const,
        title: "Nike Air Max 1 Patta Waves Noise Aqua",
        description: "Ready listing.",
        bulletPoints: ["Nike", "Air Max", "Aqua"],
        recommendedPriceCents: 24000,
        pricingRationale: null,
        itemSpecifics: {},
        marketplaceDrafts: {},
        measurements: null,
        flaws: null,
        selectedMarketplaces: ["ebay" as const],
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
    marketplaceListings: [],
    photos: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mapItem publish channel gating", () => {
  it("hides live eBay publishing when the production flag is off", () => {
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(false);
  });

  it("shows live eBay publishing only when production flag is on in production", () => {
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "true");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(true);
  });

  it("keeps sandbox eBay publishing behavior on the adapter capability", () => {
    vi.stubEnv("EBAY_ENV", "sandbox");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(false);
  });
});
