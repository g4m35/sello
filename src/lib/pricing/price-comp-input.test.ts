import { describe, expect, it } from "vitest";

import {
  CreatePriceCompRequestSchema,
  PriceCompInputSchema,
  UpdatePriceCompSchema,
} from "./price-comp-input";

describe("PriceCompInputSchema", () => {
  it("accepts a minimal manual comp and applies v2 defaults", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "eBay sold",
      title: "Air Jordan 1",
      priceCents: 22500,
    });
    expect(parsed.shippingCents).toBe(0);
    expect(parsed.condition).toBe("unknown");
    expect(parsed.sourceType).toBe("manual");
    expect(parsed.status).toBe("unknown");
    expect(parsed.currency).toBe("USD");
  });

  it("accepts the new optional v2 fields", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "StockX",
      title: "Air Jordan 1",
      priceCents: 22500,
      status: "sold",
      platform: "stockx",
      brand: "Nike",
      size: "10.5",
      matchScore: 0.92,
      totalPriceCents: 24000,
      usedInPricing: true,
      ignoredAsOutlier: false,
    });
    expect(parsed.status).toBe("sold");
    expect(parsed.matchScore).toBe(0.92);
  });

  it("rejects a non-positive price", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 0 }),
    ).toThrow();
  });

  it("rejects an out-of-range match score", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 100, matchScore: 1.5 }),
    ).toThrow();
  });

  it("rejects an invalid status enum value", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 100, status: "pending" }),
    ).toThrow();
  });

  it("rejects non-http(s) comp URLs (no javascript: scheme)", () => {
    expect(() =>
      PriceCompInputSchema.parse({
        source: "x",
        title: "y",
        priceCents: 100,
        url: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  it("accepts a normal https comp URL", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "x",
      title: "y",
      priceCents: 100,
      url: "https://www.ebay.com/itm/123",
    });
    expect(parsed.url).toBe("https://www.ebay.com/itm/123");
  });
});

describe("CreatePriceCompRequestSchema", () => {
  it("requires a uuid inventory item id", () => {
    expect(() =>
      CreatePriceCompRequestSchema.parse({
        inventoryItemId: "not-a-uuid",
        comp: { source: "x", title: "y", priceCents: 100 },
      }),
    ).toThrow();
  });
});

describe("UpdatePriceCompSchema", () => {
  it("accepts a partial update of a single field", () => {
    const parsed = UpdatePriceCompSchema.parse({ usedInPricing: false });
    expect(parsed.usedInPricing).toBe(false);
  });

  it("accepts toggling the outlier flag and status", () => {
    const parsed = UpdatePriceCompSchema.parse({ ignoredAsOutlier: true, status: "active" });
    expect(parsed.ignoredAsOutlier).toBe(true);
    expect(parsed.status).toBe("active");
  });

  it("rejects an empty update body", () => {
    expect(() => UpdatePriceCompSchema.parse({})).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() => UpdatePriceCompSchema.parse({ bogus: 1 })).toThrow();
  });

  it("rejects a non-http(s) image url", () => {
    expect(() => UpdatePriceCompSchema.parse({ imageUrl: "data:image/png;base64,AAA" })).toThrow();
  });
});
