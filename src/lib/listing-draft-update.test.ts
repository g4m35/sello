import { describe, expect, it } from "vitest";

import { ListingDraftUpdateSchema } from "./listing-draft-update";

describe("ListingDraftUpdateSchema", () => {
  it("accepts edits and supported marketplace selections", () => {
    const update = ListingDraftUpdateSchema.parse({
      title: "Nike SB Dunk Low Pro Chicago Size 10",
      description: "A careful buyer-facing listing description.",
      bulletPoints: ["Nike SB Dunk", "Chicago colorway", "US 10"],
      recommendedPriceCents: 42500,
      selectedMarketplaces: ["ebay", "grailed"],
      approve: true,
    });

    expect(update.approve).toBe(true);
    expect(update.recommendedPriceCents).toBe(42500);
    expect(update.selectedMarketplaces).toEqual(["ebay", "grailed"]);
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
