import { describe, expect, it } from "vitest";

import {
  evaluateDraftReadiness,
  type DraftReadinessInput,
} from "./draft-readiness";
import {
  buildListingExport,
  type ListingExportInput,
} from "@/lib/marketplace/export-formatters";

// Etsy is a copy-ready draft channel. These tests pin Task 5's safety rules:
// eBay readiness stays separate and authoritative for eBay publish, and Etsy's
// copy-ready output never depends on (nor blocks) eBay readiness.

const ebayReady: DraftReadinessInput = {
  productName: "Nike SB Dunk Low Pro Chicago",
  title: "Nike SB Dunk Low Pro Chicago US 10",
  description: "Authentic pair, worn twice, original box included.",
  bulletPoints: ["Nike SB Dunk", "Chicago colorway", "US 10"],
  selectedMarketplaces: ["ebay"],
  recommendedPriceCents: 42500,
  condition: "used_good",
  productCategory: "sneakers",
  brand: "Nike",
  size: "10",
  colorway: "Black/White",
  itemSpecifics: {},
  savedEbayCategoryId: null,
  savedAspects: {},
  savedQuantity: null,
  photoCount: 3,
};

function exportInput(overrides: Partial<ListingExportInput> = {}): ListingExportInput {
  return {
    productName: "Nike SB Dunk Low Pro Chicago",
    brand: "Nike",
    size: "10",
    colorway: "Black/White",
    styleCode: "BQ6817-600",
    category: "sneakers",
    condition: "used_good",
    title: "Nike SB Dunk Low Pro Chicago US 10",
    description: "Authentic pair, worn twice, original box included.",
    bulletPoints: ["Nike SB Dunk", "Chicago colorway"],
    priceCents: 42500,
    itemSpecifics: {},
    tags: ["nike sb", "dunk low", "chicago"],
    measurements: [],
    flaws: [],
    measurementProfile: "shoes",
    ...overrides,
  };
}

describe("etsy / eBay readiness isolation (Task 5)", () => {
  it("selecting Etsy alongside eBay does not change eBay readiness", () => {
    const ebayOnly = evaluateDraftReadiness({
      ...ebayReady,
      selectedMarketplaces: ["ebay"],
    });
    const withEtsy = evaluateDraftReadiness({
      ...ebayReady,
      selectedMarketplaces: ["ebay", "etsy"],
    });

    expect(ebayOnly.ready).toBe(true);
    expect(withEtsy.ready).toBe(true);
    expect(withEtsy.issues).toEqual(ebayOnly.issues);
  });

  it("an Etsy-only selection is not blocked by the marketplace requirement and still requires eBay readiness only for eBay", () => {
    const etsyOnly = evaluateDraftReadiness({
      ...ebayReady,
      selectedMarketplaces: ["etsy"],
    });

    // One selected channel satisfies the "select a marketplace" gate.
    expect(etsyOnly.issues.map((i) => i.code)).not.toContain("no_marketplace");
    // eBay-oriented checks are unchanged: nothing Etsy adds blocks eBay publish.
    expect(etsyOnly.ready).toBe(true);
  });

  it("eBay still requires eBay readiness: a missing eBay category blocks eBay publish", () => {
    const notEbayReady = evaluateDraftReadiness({
      ...ebayReady,
      productCategory: null,
      title: "Item",
      productName: "Item",
    });

    expect(notEbayReady.ready).toBe(false);
    expect(notEbayReady.issues.map((i) => i.code)).toContain("missing_category");
  });

  it("Etsy copy output renders even when eBay-specific fields are unknown", () => {
    // No eBay category / aspects are part of the export input at all: Etsy copy
    // is structurally independent of eBay readiness.
    const result = buildListingExport("etsy", exportInput());

    expect(result.body).toContain("Photo checklist");
    expect(result.body).toContain("Needs seller review");
    expect(result.warnings).toContain("Needs seller review for Etsy-specific fields");
  });

  it("Etsy copy only warns about shared fields, never about eBay-only fields", () => {
    const result = buildListingExport(
      "etsy",
      exportInput({ brand: null, priceCents: null }),
    );

    // Shared fields still matter for the copy.
    expect(result.warnings).toContain("Missing brand");
    expect(result.warnings).toContain("Missing price");
    // eBay-only readiness vocabulary never leaks into the copy advisory.
    expect(result.warnings.join(" ")).not.toMatch(/category|aspect|business policy/i);
  });
});
