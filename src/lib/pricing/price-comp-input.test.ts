import { describe, expect, it } from "vitest";

import {
  CreatePriceCompRequestSchema,
  PriceCompInputSchema,
} from "./price-comp-input";

describe("PriceCompInputSchema", () => {
  it("accepts a complete manual comp and defaults shipping/condition", () => {
    const comp = PriceCompInputSchema.parse({
      source: "eBay sold",
      title: "Nike SB Dunk Low Chicago US 10",
      priceCents: 42500,
    });

    expect(comp.shippingCents).toBe(0);
    expect(comp.condition).toBe("unknown");
  });

  it("rejects a non-positive price", () => {
    expect(() =>
      PriceCompInputSchema.parse({
        source: "eBay sold",
        title: "Nike SB Dunk Low Chicago US 10",
        priceCents: 0,
      }),
    ).toThrow();
  });

  it("requires a uuid inventory item id on the create request", () => {
    expect(() =>
      CreatePriceCompRequestSchema.parse({
        inventoryItemId: "not-a-uuid",
        comp: {
          source: "eBay sold",
          title: "Nike SB Dunk Low Chicago US 10",
          priceCents: 42500,
        },
      }),
    ).toThrow();
  });
});
