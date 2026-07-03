import { describe, expect, it } from "vitest";

import { marketplaceCapabilityLabel } from "./marketplaces";

describe("marketplaceCapabilityLabel", () => {
  it("labels assisted marketplaces as a copy-ready draft (never CSV)", () => {
    for (const marketplace of ["grailed", "poshmark", "depop", "etsy"]) {
      const label = marketplaceCapabilityLabel({ marketplace, publish: false });
      expect(label).toBe("Copy-ready draft");
      expect(label).not.toMatch(/csv/i);
    }
  });

  it("labels eBay by its live-publish capability", () => {
    expect(marketplaceCapabilityLabel({ marketplace: "ebay", publish: true })).toBe(
      "Live publishing",
    );
    expect(marketplaceCapabilityLabel({ marketplace: "ebay", publish: false })).toBe(
      "Preview + manual",
    );
  });

  it("labels StockX by live listing availability", () => {
    expect(marketplaceCapabilityLabel({ marketplace: "stockx", publish: false })).toBe(
      "Catalog match required",
    );
    expect(marketplaceCapabilityLabel({ marketplace: "stockx", publish: true })).toBe(
      "Live listing",
    );
  });
});
