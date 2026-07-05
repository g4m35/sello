import { describe, expect, it } from "vitest";

import { marketplaceCapabilityLabel } from "./marketplaces";

describe("marketplaceCapabilityLabel", () => {
  it("labels assisted marketplaces as drafts", () => {
    for (const marketplace of ["grailed", "poshmark", "depop", "etsy"]) {
      const label = marketplaceCapabilityLabel({ marketplace, publish: false });
      expect(label).toBe("Drafts");
      expect(label).not.toMatch(/csv/i);
    }
  });

  it("labels eBay by its live-publish capability", () => {
    expect(marketplaceCapabilityLabel({ marketplace: "ebay", publish: true })).toBe(
      "Live",
    );
    expect(marketplaceCapabilityLabel({ marketplace: "ebay", publish: false })).toBe(
      "Drafts",
    );
  });

  it("labels StockX by live listing availability", () => {
    expect(marketplaceCapabilityLabel({ marketplace: "stockx", publish: false })).toBe(
      "Catalog match",
    );
    expect(marketplaceCapabilityLabel({ marketplace: "stockx", publish: true })).toBe(
      "Catalog match",
    );
  });
});
