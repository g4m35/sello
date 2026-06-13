import { describe, expect, it } from "vitest";

import { ListingDraftUpdateSchema } from "./listing-draft-update";

describe("ListingDraftUpdateSchema", () => {
  it("accepts edits and supported marketplace selections", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "Nike SB Dunk Low Pro Chicago Size 10",
      description: "A careful buyer-facing listing description.",
      bulletPoints: ["Nike SB Dunk", "Chicago colorway", "US 10"],
      recommendedPriceCents: 42500,
      marketplaceDrafts: {
        ebay: { categoryId: "15709" },
      },
      selectedMarketplaces: ["ebay", "grailed"],
      approve: true,
    });

    expect(update.approve).toBe(true);
    expect(update.recommendedPriceCents).toBe(42500);
    expect(update.marketplaceDrafts?.ebay?.categoryId).toBe("15709");
    expect(update.selectedMarketplaces).toEqual(["ebay", "grailed"]);
  });

  it("accepts a blank eBay category ID for autosave", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "",
      description: "",
      bulletPoints: [],
      recommendedPriceCents: null,
      marketplaceDrafts: {
        ebay: { categoryId: "" },
      },
      selectedMarketplaces: [],
    });

    expect(update.marketplaceDrafts?.ebay?.categoryId).toBe("");
  });

  it("accepts seller-filled eBay aspects for draft persistence", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "Nike Air Max 1 Patta Waves Noise Aqua",
      description: "Authentic pair.",
      bulletPoints: [],
      recommendedPriceCents: 24000,
      marketplaceDrafts: {
        ebay: {
          categoryId: "15709",
          aspects: {
            "US Shoe Size": "10.5",
            Department: "Men",
            Color: "Noise Aqua",
          },
        },
      },
      selectedMarketplaces: ["ebay"],
    });

    expect(update.marketplaceDrafts?.ebay?.aspects).toEqual({
      "US Shoe Size": "10.5",
      Department: "Men",
      Color: "Noise Aqua",
    });
  });

  it("accepts explicit eBay quantity for draft persistence", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "Nike Air Max 1 Patta Waves Noise Aqua",
      description: "Authentic pair.",
      bulletPoints: [],
      recommendedPriceCents: 24000,
      marketplaceDrafts: {
        ebay: { categoryId: "15709", quantity: 1 },
      },
      selectedMarketplaces: ["ebay"],
    });

    expect(update.marketplaceDrafts?.ebay?.quantity).toBe(1);
  });

  it("rejects malformed eBay category IDs", () => {
    expect(() =>
      ListingDraftUpdateSchema.parse({
        title: "",
        description: "",
        bulletPoints: [],
        recommendedPriceCents: null,
        marketplaceDrafts: {
          ebay: { categoryId: "abc-123" },
        },
        selectedMarketplaces: [],
      }),
    ).toThrow();
  });

  it("rejects unsupported marketplace selections", () => {
    expect(() =>
      ListingDraftUpdateSchema.parse({
        title: "Nike SB Dunk Low Pro Chicago Size 10",
        description: "A careful buyer-facing listing description.",
        bulletPoints: ["Nike SB Dunk", "Chicago colorway", "US 10"],
        selectedMarketplaces: ["ebay", "stockx"],
      }),
    ).toThrow();
  });

  it("accepts incomplete edits for autosave", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "",
      description: "",
      bulletPoints: [],
      recommendedPriceCents: null,
      selectedMarketplaces: [],
    });

    expect(update.approve).toBe(false);
    expect(update.title).toBe("");
  });

  it("requires complete fields before approval", () => {
    expect(() =>
      ListingDraftUpdateSchema.parse({
        title: "",
        description: "",
        bulletPoints: [],
        recommendedPriceCents: null,
        selectedMarketplaces: [],
        approve: true,
      }),
    ).toThrow();
  });
});
