import { describe, expect, it } from "vitest";

import { scoreCompMatch } from "@/lib/comps/scoring";
import type { NormalizedComp } from "@/lib/comps/source";

const item = {
  productName: "The North Face Black Nuptse Puffer Jacket",
  brand: "The North Face",
  styleCode: null,
  size: "Large",
  category: "streetwear",
  colorway: "Black",
  condition: "used_good",
};

function comp(overrides: Partial<NormalizedComp> = {}): NormalizedComp {
  return {
    source: "ebay-browse",
    externalId: "1",
    title: "The North Face Nuptse Black Puffer Jacket Mens Large",
    priceCents: 18000,
    shippingCents: 1200,
    soldDate: null,
    url: "https://www.ebay.com/itm/1",
    sold: false,
    condition: "used_good",
    brand: "The North Face",
    size: "Large",
    currency: "USD",
    imageUrl: null,
    rawJson: null,
    ...overrides,
  };
}

describe("scoreCompMatch", () => {
  it("classifies same-brand same-model comps as strong", () => {
    const scored = scoreCompMatch(item, comp());
    expect(scored.classification).toBe("strong");
    expect(scored.score).toBeGreaterThanOrEqual(0.7);
    expect(scored.reasons).toContain("Brand matches.");
    expect(scored.reasons.some((r) => r.toLowerCase().includes("title token"))).toBe(true);
  });

  it("keeps partial but plausible matches as possible", () => {
    const scored = scoreCompMatch(
      item,
      comp({
        title: "The North Face Black Puffer Jacket Medium",
        size: "Medium",
      }),
    );
    expect(scored.classification).toBe("possible");
    expect(scored.score).toBeGreaterThanOrEqual(0.45);
    expect(scored.score).toBeLessThan(0.72);
  });

  it("rejects unrelated comps so they cannot drive automatic pricing", () => {
    const scored = scoreCompMatch(
      item,
      comp({
        title: "Nike Dunk Low Panda Sneakers Size 10",
        brand: "Nike",
        size: "10",
        category: "sneakers",
      }),
    );
    expect(scored.classification).toBe("rejected");
    expect(scored.score).toBeLessThan(0.3);
    expect(scored.reasons).toContain("Brand differs.");
  });
});
