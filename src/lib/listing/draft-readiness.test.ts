import { describe, expect, it } from "vitest";

import { evaluateDraftReadiness, type DraftReadinessInput } from "./draft-readiness";

// A fully complete pair of sneakers: a size-required eBay category (Men's
// Athletic Shoes / 15709) with every required aspect resolvable from saved data.
const readySneakers: DraftReadinessInput = {
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

describe("evaluateDraftReadiness", () => {
  it("passes a fully complete size-required item", () => {
    const result = evaluateDraftReadiness(readySneakers);

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks ready when size is missing for a size-required category", () => {
    const result = evaluateDraftReadiness({ ...readySneakers, size: null });

    expect(result.ready).toBe(false);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("missing_size");
    // Size must be its own specific reason, not lumped into "item specifics".
    expect(codes).not.toContain("missing_item_specifics");
  });

  it("surfaces a size check in the checklist for size-required categories", () => {
    const miss = evaluateDraftReadiness({ ...readySneakers, size: null });
    const sizeCheck = miss.checks.find((c) => c.id === "size");
    expect(sizeCheck?.blocking).toBe(true);
    expect(sizeCheck?.state).toBe("miss");

    const done = evaluateDraftReadiness(readySneakers).checks.find((c) => c.id === "size");
    expect(done?.state).toBe("done");
  });

  it("requires a known condition", () => {
    const result = evaluateDraftReadiness({ ...readySneakers, condition: "unknown" });
    expect(result.ready).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("missing_condition");
  });

  it("requires at least one photo but only recommends three", () => {
    expect(
      evaluateDraftReadiness({ ...readySneakers, photoCount: 0 }).issues.map((i) => i.code),
    ).toContain("missing_photos");

    const twoPhotos = evaluateDraftReadiness({ ...readySneakers, photoCount: 2 });
    expect(twoPhotos.ready).toBe(true);
    expect(twoPhotos.issues.map((i) => i.code)).not.toContain("missing_photos");
  });

  it("defaults missing quantity to 1 but rejects an explicit invalid quantity", () => {
    expect(evaluateDraftReadiness({ ...readySneakers, savedQuantity: null }).ready).toBe(true);
    expect(
      evaluateDraftReadiness({ ...readySneakers, savedQuantity: 0 }).issues.map((i) => i.code),
    ).toContain("invalid_quantity");
  });

  it("blocks when the eBay category cannot be resolved (eBay selected)", () => {
    const result = evaluateDraftReadiness({
      ...readySneakers,
      productCategory: "other",
      title: "Mystery vintage piece",
      productName: "Mystery vintage piece",
    });
    expect(result.ready).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("missing_category");
  });

  it("does NOT require eBay category/size when eBay is not a selected channel", () => {
    // An unresolvable eBay category blocks an eBay listing, but a copy-ready
    // listing targeting only Etsy must not inherit eBay-only field requirements.
    const result = evaluateDraftReadiness({
      ...readySneakers,
      productCategory: "other",
      title: "Mystery vintage piece",
      productName: "Mystery vintage piece",
      selectedMarketplaces: ["etsy"],
    });
    const codes = result.issues.map((i) => i.code);
    expect(codes).not.toContain("missing_category");
    expect(codes).not.toContain("missing_size");
    expect(codes).not.toContain("missing_item_specifics");
    expect(result.checks.some((c) => c.id === "category")).toBe(false);
    expect(result.ready).toBe(true);
  });

  it("still enforces shared content fields when eBay is not selected", () => {
    const result = evaluateDraftReadiness({
      ...readySneakers,
      selectedMarketplaces: ["etsy"],
      recommendedPriceCents: null,
      condition: "unknown",
    });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("missing_price");
    expect(codes).toContain("missing_condition");
    expect(result.ready).toBe(false);
  });

  it("still enforces the content minimums (title, description, bullets, price, marketplaces)", () => {
    const result = evaluateDraftReadiness({
      ...readySneakers,
      title: "short",
      description: "too short",
      bulletPoints: ["only one"],
      selectedMarketplaces: [],
      recommendedPriceCents: null,
    });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("title_too_short");
    expect(codes).toContain("description_too_short");
    expect(codes).toContain("insufficient_bullets");
    expect(codes).toContain("no_marketplace");
    expect(codes).toContain("missing_price");
  });
});
