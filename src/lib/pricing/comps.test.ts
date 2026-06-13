import { describe, expect, it } from "vitest";

import { calculatePricing, type PricingComp } from "./comps";

function comp(overrides: Partial<PricingComp> = {}): PricingComp {
  return { priceCents: 10000, shippingCents: 0, ...overrides };
}

describe("calculatePricing", () => {
  it("reports needs_comps when there are no comps", () => {
    const s = calculatePricing([]);
    expect(s.status).toBe("needs_comps");
    expect(s.confidence).toBe("none");
    expect(s.confidenceScore).toBe(0);
    expect(s.confidenceReasons.length).toBeGreaterThan(0);
    expect(s.validComps).toBe(0);
    expect(s.compCount).toBe(0);
    expect(s.medianCents).toBeNull();
    expect(s.averageCents).toBeNull();
    expect(s.quickSaleCents).toBeNull();
    expect(s.recommendedListCents).toBeNull();
  });

  it("adds shipping to price for the comp total", () => {
    const s = calculatePricing([comp({ priceCents: 10000, shippingCents: 1500 })]);
    expect(s.status).toBe("ready");
    expect(s.lowCents).toBe(11500);
    expect(s.medianCents).toBe(11500);
    expect(s.averageCents).toBe(11500);
    expect(s.highCents).toBe(11500);
  });

  it("uses totalPriceCents when present instead of price + shipping", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, shippingCents: 1500, totalPriceCents: 9000 }),
    ]);
    expect(s.medianCents).toBe(9000);
  });

  it("computes low, median, average, and high across valid comps", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 20000 }),
      comp({ priceCents: 30000 }),
    ]);
    expect(s.lowCents).toBe(10000);
    expect(s.medianCents).toBe(20000);
    expect(s.averageCents).toBe(20000);
    expect(s.highCents).toBe(30000);
  });

  it("anchors quick-sale and recommended on the MEDIAN, not the average", () => {
    // median 10000, average 20000 — proves median is the anchor.
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 10000 }),
      comp({ priceCents: 40000 }),
    ]);
    expect(s.medianCents).toBe(10000);
    expect(s.averageCents).toBe(20000);
    expect(s.quickSaleCents).toBe(9000); // 10000 * 0.9
    expect(s.recommendedListCents).toBe(11000); // 10000 * 1.1
  });

  it("excludes comps flagged usedInPricing=false", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, usedInPricing: true }),
      comp({ priceCents: 99999, usedInPricing: false }),
    ]);
    expect(s.totalComps).toBe(2);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("excludes comps flagged ignoredAsOutlier=true", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 99999, ignoredAsOutlier: true }),
    ]);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("ignores comps with non-positive price or invalid shipping", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, shippingCents: 0 }),
      comp({ priceCents: 0 }),
      comp({ priceCents: -500 }),
      comp({ priceCents: 12000, shippingCents: -100 }),
      comp({ priceCents: Number.NaN }),
    ]);
    expect(s.totalComps).toBe(5);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("prefers sold comps over active comps when at least 2 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 12000, status: "sold" }),
      comp({ priceCents: 14000, status: "sold" }),
      comp({ priceCents: 50000, status: "active" }),
      comp({ priceCents: 50000, status: "active" }),
    ]);
    expect(s.soldCompCount).toBe(3);
    expect(s.activeCompCount).toBe(2);
    // Active 50000s are excluded from the anchor because sold comps dominate.
    expect(s.medianCents).toBe(12000);
    expect(s.highCents).toBe(14000);
    expect(s.confidenceReasons.some((r) => r.includes("sold"))).toBe(true);
  });

  it("falls back to all eligible comps when fewer than 2 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 20000, status: "active" }),
      comp({ priceCents: 30000, status: "active" }),
    ]);
    expect(s.medianCents).toBe(20000); // all three used
  });

  it("scales confidence up for a large, recent, consistent sold sample", () => {
    const today = new Date();
    const s = calculatePricing(
      Array.from({ length: 5 }, (_, i) =>
        comp({
          priceCents: 20000 + i * 200,
          status: "sold",
          soldDate: today,
          brand: "Nike",
          size: "10",
          condition: "used_good",
          matchScore: 0.9,
        }),
      ),
    );
    expect(s.confidence).toBe("high");
    expect(s.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(s.confidenceReasons.some((r) => r.includes("sold"))).toBe(true);
  });

  it("returns low confidence for a single active asking-price comp", () => {
    const s = calculatePricing([comp({ priceCents: 10000, status: "active" })]);
    expect(s.confidence).toBe("low");
    expect(s.confidenceReasons.some((r) => r.toLowerCase().includes("active"))).toBe(true);
  });

  it("penalizes a wide price spread in the confidence reasons", () => {
    const s = calculatePricing([
      comp({ priceCents: 5000, status: "active" }),
      comp({ priceCents: 8000, status: "active" }),
      comp({ priceCents: 60000, status: "active" }),
    ]);
    expect(s.confidenceReasons.some((r) => r.toLowerCase().includes("spread"))).toBe(true);
  });
});
