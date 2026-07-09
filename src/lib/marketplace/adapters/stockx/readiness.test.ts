import { describe, expect, it } from "vitest";

import { evaluateStockXListingReadiness } from "./readiness";

describe("StockX listing readiness", () => {
  it("requires enabled API/listing config, connection, exact variant match, price, inventory, and confirmation", () => {
    const readiness = evaluateStockXListingReadiness({
      apiConfigured: false,
      listingEnabled: false,
      connected: false,
      productId: null,
      variantId: null,
      priceCents: null,
      quantityAvailable: 0,
      confirmed: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "stockx_api",
      "stockx_listing_enabled",
      "stockx_connection",
      "stockx_product_match",
      "stockx_variant_match",
      "price",
      "inventory_quantity",
      "confirmation",
    ]);
  });

  it("passes only when the seller has confirmed a connected, matched, priced listing", () => {
    expect(
      evaluateStockXListingReadiness({
        apiConfigured: true,
        listingEnabled: true,
        connected: true,
        productId: "product-1",
        variantId: "variant-1",
        priceCents: 14000,
        quantityAvailable: 1,
        confirmed: true,
      }),
    ).toEqual({ ready: true, missing: [] });
  });
});
