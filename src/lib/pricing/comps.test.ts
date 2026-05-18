import { describe, expect, it } from "vitest";

import { calculatePricing } from "./comps";

describe("calculatePricing", () => {
  it("reports needs_comps when there are no comps", () => {
    const summary = calculatePricing([]);

    expect(summary.status).toBe("needs_comps");
    expect(summary.confidence).toBe("none");
    expect(summary.validComps).toBe(0);
    expect(summary.lowCents).toBeNull();
    expect(summary.averageCents).toBeNull();
    expect(summary.highCents).toBeNull();
    expect(summary.quickSaleCents).toBeNull();
    expect(summary.recommendedListCents).toBeNull();
  });

  it("adds shipping to price for the comp total", () => {
    const summary = calculatePricing([{ priceCents: 10000, shippingCents: 1500 }]);

    expect(summary.status).toBe("ready");
    expect(summary.lowCents).toBe(11500);
    expect(summary.averageCents).toBe(11500);
    expect(summary.highCents).toBe(11500);
  });

  it("computes low, average, and high across valid comps", () => {
    const summary = calculatePricing([
      { priceCents: 10000, shippingCents: 0 },
      { priceCents: 20000, shippingCents: 0 },
      { priceCents: 30000, shippingCents: 0 },
    ]);

    expect(summary.lowCents).toBe(10000);
    expect(summary.averageCents).toBe(20000);
    expect(summary.highCents).toBe(30000);
  });

  it("places quick-sale below and recommended list above the average", () => {
    const summary = calculatePricing([
      { priceCents: 20000, shippingCents: 0 },
      { priceCents: 20000, shippingCents: 0 },
    ]);

    expect(summary.averageCents).toBe(20000);
    expect(summary.quickSaleCents).toBe(18000);
    expect(summary.recommendedListCents).toBe(22000);
    expect(summary.quickSaleCents! < summary.averageCents!).toBe(true);
    expect(summary.recommendedListCents! > summary.averageCents!).toBe(true);
  });

  it("ignores comps with non-positive price or invalid shipping", () => {
    const summary = calculatePricing([
      { priceCents: 10000, shippingCents: 0 },
      { priceCents: 0, shippingCents: 0 },
      { priceCents: -500, shippingCents: 0 },
      { priceCents: 12000, shippingCents: -100 },
      { priceCents: Number.NaN, shippingCents: 0 },
    ]);

    expect(summary.totalComps).toBe(5);
    expect(summary.validComps).toBe(1);
    expect(summary.averageCents).toBe(10000);
  });

  it("scales confidence with the count of valid comps", () => {
    const one = calculatePricing([{ priceCents: 10000, shippingCents: 0 }]);
    const three = calculatePricing(
      Array.from({ length: 3 }, () => ({ priceCents: 10000, shippingCents: 0 })),
    );
    const five = calculatePricing(
      Array.from({ length: 5 }, () => ({ priceCents: 10000, shippingCents: 0 })),
    );

    expect(one.confidence).toBe("low");
    expect(three.confidence).toBe("medium");
    expect(five.confidence).toBe("high");
  });

  it("downgrades confidence one level when comp totals are widely dispersed", () => {
    const summary = calculatePricing([
      { priceCents: 5000, shippingCents: 0 },
      { priceCents: 8000, shippingCents: 0 },
      { priceCents: 10000, shippingCents: 0 },
      { priceCents: 30000, shippingCents: 0 },
      { priceCents: 60000, shippingCents: 0 },
    ]);

    expect(summary.validComps).toBe(5);
    expect(summary.confidence).toBe("medium");
  });
});
