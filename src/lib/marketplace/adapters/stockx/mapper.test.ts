import { describe, expect, it } from "vitest";

import { buildStockXCreateListingPayload } from "./mapper";

describe("StockX listing mapper", () => {
  it("builds the official create-listing payload from a matched variant and cents price", () => {
    expect(
      buildStockXCreateListingPayload({
        variantId: "98e2e748-8000-45bf-a624-5531d6a68318",
        priceCents: 12500,
      }),
    ).toEqual({
      amount: "125.00",
      variantId: "98e2e748-8000-45bf-a624-5531d6a68318",
    });
  });

  it("rejects missing variant and invalid prices before any StockX request can be made", () => {
    expect(() =>
      buildStockXCreateListingPayload({ variantId: "", priceCents: 12500 }),
    ).toThrow(/variant/i);
    expect(() =>
      buildStockXCreateListingPayload({ variantId: "variant-1", priceCents: 0 }),
    ).toThrow(/price/i);
  });
});
