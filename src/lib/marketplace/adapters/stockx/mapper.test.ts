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
      amount: "125",
      variantId: "98e2e748-8000-45bf-a624-5531d6a68318",
      currencyCode: "USD",
      active: true,
      inventoryType: "STANDARD",
    });
  });

  it("preserves cents only when the StockX amount is not a whole dollar", () => {
    expect(
      buildStockXCreateListingPayload({
        variantId: "variant-1",
        priceCents: 12599,
      }).amount,
    ).toBe("125.99");
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
