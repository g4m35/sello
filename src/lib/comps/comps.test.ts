import { describe, expect, it } from "vitest";

import { buildCompQuery } from "@/lib/comps/match";
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
  it("prefixes the source with auto: and guards the url scheme", () => {
    const row = toPriceCompCreate("item-1", comp({ source: "ebay-browse", url: "javascript:alert(1)" }));
    expect(row.source).toBe("auto:ebay-browse");
    expect(row.url).toBeNull();
  });
});
