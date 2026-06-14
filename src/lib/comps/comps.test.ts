import { describe, expect, it } from "vitest";

import { buildCompQuery } from "@/lib/comps/match";
import { buildCompQueryVariants } from "@/lib/comps/query";
import { dedupeComps, toPriceCompCreate, trimOutliers } from "@/lib/comps/normalize";
import type { NormalizedComp } from "@/lib/comps/source";

function comp(overrides: Partial<NormalizedComp>): NormalizedComp {
  return {
    source: "ebay-browse",
    externalId: null,
    title: "Air Jordan 1",
    priceCents: 20000,
    shippingCents: 0,
    soldDate: null,
    url: null,
    sold: false,
    condition: "unknown",
    ...overrides,
  };
}

describe("buildCompQuery", () => {
  it("prefers brand + style code", () => {
    const q = buildCompQuery({
      productName: "Air Jordan 1 Retro High",
      brand: "Nike",
      styleCode: "DM7866-162",
      size: "10.5",
      category: "sneakers",
    });
    expect(q.keywords).toBe("Nike DM7866-162");
    expect(q.styleCode).toBe("DM7866-162");
  });

  it("falls back to product name when no style code", () => {
    const q = buildCompQuery({
      productName: "Supreme Box Logo Hoodie",
      brand: null,
      styleCode: null,
      size: "L",
      category: "streetwear",
    });
    expect(q.keywords).toBe("Supreme Box Logo Hoodie");
  });
});

describe("buildCompQueryVariants", () => {
  it("generates strict, broad, marketplace, and sold-intent variants for apparel", () => {
    const variants = buildCompQueryVariants({
      productName: "The North Face Black Nuptse Puffer Jacket",
      brand: "The North Face",
      styleCode: null,
      size: "Large",
      category: "streetwear",
      colorway: "Black",
      condition: "used_good",
      description:
        "Classic black Nuptse puffer jacket with zip pockets and stowable hood.",
    });

    expect(variants.map((v) => v.kind)).toEqual(["strict", "broad", "marketplace"]);
    expect(variants[0].keywords).toContain("The North Face");
    expect(variants[0].keywords).toContain("Nuptse");
    expect(variants[0].keywords).toContain("Large");
    expect(variants.some((v) => v.keywords.includes("sold"))).toBe(true);
    expect(variants.every((v) => v.keywords.length <= 140)).toBe(true);
  });

  it("prioritizes sneaker style codes and size in the strict variant", () => {
    const variants = buildCompQueryVariants({
      productName: "Travis Scott Air Jordan 1 Low Reverse Mocha",
      brand: "Nike",
      styleCode: "DM7866-162",
      size: "US 10",
      category: "sneakers",
      colorway: "Reverse Mocha",
      condition: "used_good",
      description: "",
    });

    expect(variants[0].keywords).toBe("Nike DM7866-162 US 10 sold");
    expect(variants[1].keywords).toContain("Reverse Mocha");
  });
});

describe("dedupeComps", () => {
  it("dedupes by source + externalId", () => {
    const out = dedupeComps([
      comp({ externalId: "1" }),
      comp({ externalId: "1" }),
      comp({ externalId: "2" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("trimOutliers", () => {
  it("removes extreme outliers from a larger sample", () => {
    const prices = [18000, 19000, 20000, 21000, 22000, 200000];
    const out = trimOutliers(prices.map((p) => comp({ priceCents: p, externalId: String(p) })));
    expect(out.some((c) => c.priceCents === 200000)).toBe(false);
  });
  it("is a no-op for small samples", () => {
    const small = [comp({ externalId: "a" }), comp({ priceCents: 999999, externalId: "b" })];
    expect(trimOutliers(small)).toHaveLength(2);
  });
});

describe("toPriceCompCreate", () => {
  it("prefixes the source with auto:, stores scoring metadata, and guards the url scheme", () => {
    const row = toPriceCompCreate(
      "item-1",
      comp({
        source: "ebay-browse",
        url: "javascript:alert(1)",
        matchScore: 0.82,
        matchClassification: "strong",
        matchReasons: ["Brand match", "Title overlap"],
      }),
    );
    expect(row.source).toBe("auto:ebay-browse");
    expect(row.url).toBeNull();
    expect(row.matchScore).toBe(0.82);
    expect(row.usedInPricing).toBe(true);
    expect(row.rawJson).toMatchObject({
      matchClassification: "strong",
      matchReasons: ["Brand match", "Title overlap"],
    });
  });

  it("keeps weak automatic comps visible but excludes them from pricing", () => {
    const row = toPriceCompCreate(
      "item-1",
      comp({
        source: "ebay-browse",
        matchScore: 0.2,
        matchClassification: "rejected",
        matchReasons: ["Different brand"],
      }),
    );
    expect(row.usedInPricing).toBe(false);
    expect(row.ignoredAsOutlier).toBe(true);
    expect(row.notes).toContain("Rejected automatic comp");
  });
});
