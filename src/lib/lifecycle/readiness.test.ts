import { describe, expect, it } from "vitest";

import { evaluateReadiness, READINESS_THRESHOLDS } from "./readiness";

const ready = {
  productName: "Nike SB Dunk Low Pro Chicago",
  title: "Nike SB Dunk Low Pro Chicago US 10",
  description: "Authentic pair, worn twice, original box included.",
  bulletPoints: ["Nike SB Dunk", "Chicago colorway", "US 10"],
  selectedMarketplaces: ["ebay"],
  recommendedPriceCents: 42500,
};

describe("evaluateReadiness", () => {
  it("passes a fully complete item", () => {
    const result = evaluateReadiness(ready);

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags an unidentified product (placeholder or empty name)", () => {
    expect(
      evaluateReadiness({ ...ready, productName: "Awaiting Gemini identification" })
        .issues.map((issue) => issue.code),
    ).toContain("unidentified_product");

    expect(
      evaluateReadiness({ ...ready, productName: "" }).issues.map((i) => i.code),
    ).toContain("unidentified_product");
  });

  it("requires a positive seller price before ready", () => {
    expect(
      evaluateReadiness({ ...ready, recommendedPriceCents: null }).ready,
    ).toBe(false);
    expect(
      evaluateReadiness({ ...ready, recommendedPriceCents: 0 }).issues.map(
        (i) => i.code,
      ),
    ).toContain("missing_price");
  });

  it("enforces title, description, bullet, and marketplace minimums", () => {
    const result = evaluateReadiness({
      productName: "Some Item",
      title: "short",
      description: "too short",
      bulletPoints: ["only one"],
      selectedMarketplaces: [],
      recommendedPriceCents: 1000,
    });

    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("title_too_short");
    expect(codes).toContain("description_too_short");
    expect(codes).toContain("insufficient_bullets");
    expect(codes).toContain("no_marketplace");
    expect(result.ready).toBe(false);
  });

  it("ignores blank bullet lines when counting", () => {
    const result = evaluateReadiness({
      ...ready,
      bulletPoints: ["one", "  ", "", "two"],
    });

    expect(result.issues.map((i) => i.code)).toContain("insufficient_bullets");
  });

  it("exposes thresholds as a single source of truth", () => {
    expect(READINESS_THRESHOLDS.titleMinLength).toBe(10);
    expect(READINESS_THRESHOLDS.descriptionMinLength).toBe(20);
    expect(READINESS_THRESHOLDS.minBulletPoints).toBe(3);
    expect(READINESS_THRESHOLDS.minMarketplaces).toBe(1);
  });
});
