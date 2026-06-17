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

  it("prefers sold comps over active comps when at least 3 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 12000, status: "sold" }),
      comp({ priceCents: 14000, status: "sold" }),
      comp({ priceCents: 50000, status: "active" }),
      comp({ priceCents: 50000, status: "active" }),
    ]);
    expect(s.soldCompCount).toBe(3);
    expect(s.activeCompCount).toBe(2);
    expect(s.pricingBasis).toBe("sold_comps");
    // Active 50000s are excluded from the anchor because sold comps dominate.
    expect(s.medianCents).toBe(12000);
    expect(s.highCents).toBe(14000);
    expect(s.confidenceReasons.some((r) => r.includes("sold"))).toBe(true);
  });

  it("falls back to all eligible comps when fewer than 3 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 20000, status: "active" }),
      comp({ priceCents: 30000, status: "active" }),
    ]);
    expect(s.medianCents).toBe(20000); // all three used
    expect(s.pricingBasis).toBe("mixed_comps");
    expect(s.confidenceReasons.join(" ")).toContain("fewer than 3");
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
    expect(s.pricingBasis).toBe("sold_comps");
  });

  it("caps many possible sold matches at medium confidence", () => {
    const today = new Date();
    const s = calculatePricing(
      Array.from({ length: 20 }, (_, i) =>
        comp({
          priceCents: 1200 + i * 15,
          status: "sold",
          soldDate: today,
          brand: "Generic",
          size: "M",
          condition: "used_good",
          matchScore: 0.55,
        }),
      ),
    );

    expect(s.soldCompCount).toBe(20);
    expect(s.strongCompCount).toBe(0);
    expect(s.possibleCompCount).toBe(20);
    expect(s.confidence).toBe("medium");
    expect(s.confidenceScore).toBeLessThan(0.7);
    expect(s.confidenceReasons.join(" ")).toContain("Only possible matches found");
  });

  it("keeps weak generic shirt comps from producing high confidence", () => {
    const today = new Date();
    const s = calculatePricing(
      [
        "Pro Club Men's Heavyweight T-Shirt Crew Neck Plain Blank Short Sleeve Tee",
        "Zenana Crew Neck Short Sleeve T Shirt Basic Plain Solid Top Cotton",
        "Gildan Men's Dryblend Plain Crew Neck Short Sleeves T-Shirt",
        "True Classic Men's T-Shirt Short Sleeve Athletic Cut Crew Neck Basics Tee",
        "Nike Dri-FIT Men’s Gray T-Shirt L Crew Neck Short Sleeve",
      ].map((title, i) =>
        comp({
          priceCents: 850 + i * 180,
          totalPriceCents: 1000 + i * 220,
          status: "sold",
          soldDate: today,
          brand: title.split(" ")[0],
          size: null,
          condition: "unknown",
          matchScore: 0.54,
        }),
      ),
    );

    expect(s.confidence).not.toBe("high");
    expect(s.confidenceReasons.join(" ")).toContain("Generic item identity");
    expect(s.confidenceReasons.join(" ")).toContain("No exact brand/model match");
  });

  it("lets a strong same-brand sold cluster reach high confidence", () => {
    const today = new Date();
    const s = calculatePricing(
      Array.from({ length: 6 }, (_, i) =>
        comp({
          priceCents: 18000 + i * 250,
          status: "sold",
          soldDate: today,
          brand: "The North Face",
          size: "Large",
          condition: "used_good",
          matchScore: 0.86,
        }),
      ),
    );

    expect(s.confidence).toBe("high");
    expect(s.confidenceReasons.join(" ")).toContain("Strong sold-comp cluster");
  });

  it("downgrades wide sold-comp spreads below high confidence", () => {
    const s = calculatePricing([
      comp({ priceCents: 5000, status: "sold", matchScore: 0.9 }),
      comp({ priceCents: 7000, status: "sold", matchScore: 0.9 }),
      comp({ priceCents: 9000, status: "sold", matchScore: 0.9 }),
      comp({ priceCents: 45000, status: "sold", matchScore: 0.9 }),
      comp({ priceCents: 60000, status: "sold", matchScore: 0.9 }),
    ]);

    expect(s.confidence).not.toBe("high");
    expect(s.confidenceReasons.join(" ")).toContain("Wide price spread");
  });

  it("downgrades low sold-comp counts", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold", matchScore: 0.9 }),
      comp({ priceCents: 11000, status: "sold", matchScore: 0.9 }),
    ]);

    expect(s.confidence).toBe("low");
    expect(s.confidenceReasons.join(" ")).toContain("Low sold-comp count");
  });

  it("returns low confidence for a single active asking-price comp", () => {
    const s = calculatePricing([comp({ priceCents: 10000, status: "active" })]);
    expect(s.confidence).toBe("low");
    expect(s.confidenceReasons.some((r) => r.toLowerCase().includes("active"))).toBe(true);
  });

  it("caps active-listing-only recommendations at medium confidence", () => {
    const s = calculatePricing(
      Array.from({ length: 8 }, (_, i) =>
        comp({
          priceCents: 18000 + i * 100,
          status: "active",
          brand: "The North Face",
          size: "Large",
          condition: "used_good",
          matchScore: 0.9,
        }),
      ),
    );

    expect(s.pricingBasis).toBe("active_market_estimate");
    expect(s.confidence).toBe("medium");
    expect(s.confidenceScore).toBeLessThan(0.7);
    expect(s.confidenceCapReason).toContain("active market listings");
    expect(s.confidenceReasons.join(" ")).toContain("not sold comps");
  });

  it("lets a manual sold comp improve a market listing estimate without pretending it is enough sold data", () => {
    const s = calculatePricing([
      comp({ priceCents: 13000, status: "sold", sourceType: "manual", matchScore: null }),
      comp({ priceCents: 18000, status: "active", matchScore: 0.8 }),
      comp({ priceCents: 19000, status: "active", matchScore: 0.8 }),
    ]);

    expect(s.soldCompCount).toBe(1);
    expect(s.activeCompCount).toBe(2);
    expect(s.pricingBasis).toBe("mixed_comps");
    expect(s.medianCents).toBe(18000);
    expect(s.confidenceReasons.join(" ")).toContain("Includes 1 sold comp");
  });

  it("caps mixed recommendations below high confidence until at least 3 sold comps match", () => {
    const s = calculatePricing([
      comp({ priceCents: 21000, status: "sold", sourceType: "manual", matchScore: null }),
      ...Array.from({ length: 11 }, (_, i) =>
        comp({
          priceCents: 14000 + i * 300,
          status: "active",
          brand: "The North Face",
          size: "Large",
          condition: "used_good",
          matchScore: 0.9,
        }),
      ),
    ]);

    expect(s.soldCompCount).toBe(1);
    expect(s.activeCompCount).toBe(11);
    expect(s.pricingBasis).toBe("mixed_comps");
    expect(s.confidence).toBe("medium");
    expect(s.confidenceScore).toBeLessThan(0.7);
    expect(s.confidenceCapReason).toContain("fewer than 3 sold comps");
  });

  it("counts seller-entered sold comps without match scores as possible comps", () => {
    const s = calculatePricing([
      comp({ priceCents: 15000, status: "sold", sourceType: "manual", matchScore: null }),
      comp({ priceCents: 16000, status: "sold", sourceType: "manual", matchScore: null }),
      comp({ priceCents: 17000, status: "sold", sourceType: "manual", matchScore: null }),
    ]);

    expect(s.pricingBasis).toBe("sold_comps");
    expect(s.possibleCompCount).toBe(3);
    expect(s.confidence).toBe("medium");
    expect(s.confidenceReasons.join(" ")).toContain("strong/possible comps");
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
