import { describe, expect, it } from "vitest";

import {
  buildEbayInventoryItemPayload,
  buildEbayOfferPayload,
  resolveEbaySku,
} from "./mapper";
import type { EbayMapperInput } from "./mapper";

function baseInput(): EbayMapperInput {
  return {
    item: {
      id: "0d1e2f34-5678-4abc-9def-0123456789ab",
      sellerId: "user-1",
      brand: "Nike",
      condition: "new_with_tags",
      size: "US 10",
      colorway: "Noise Aqua",
      sku: null,
    },
    draft: {
      title: "Nike Air Max 1 Patta Waves Noise Aqua",
      description: "Authentic deadstock pair. Ships double-boxed.",
      priceCents: 24000,
      quantity: 2,
      categoryId: "15709",
      itemSpecifics: { Department: "Men", Type: "Athletic" },
    },
    photos: [
      { url: "https://img.example.com/1.jpg" },
      { url: "https://img.example.com/2.jpg" },
    ],
    sellerConfig: {
      marketplaceId: "EBAY_US",
      paymentPolicyId: "pay-1",
      fulfillmentPolicyId: "ful-1",
      returnPolicyId: "ret-1",
      merchantLocationKey: "loc-1",
    },
  };
}

describe("resolveEbaySku", () => {
  it("normalizes an existing SKU when present", () => {
    const input = baseInput();
    input.item.sku = "custom-sku-123";
    expect(resolveEbaySku(input.item)).toBe("customsku123");
  });

  it("derives a deterministic SKU from the inventory item id", () => {
    const input = baseInput();
    expect(resolveEbaySku(input.item)).toBe(
      "percs0d1e2f3456784abc9def0123456789ab",
    );
    // Deterministic: same input, same output.
    expect(resolveEbaySku(input.item)).toBe(resolveEbaySku(input.item));
  });
});

describe("buildEbayInventoryItemPayload", () => {
  it("maps title, description, condition, quantity, images and aspects", () => {
    const payload = buildEbayInventoryItemPayload(baseInput());

    expect(payload.condition).toBe("NEW_WITH_TAGS");
    expect(payload.availability.shipToLocationAvailability.quantity).toBe(2);
    expect(payload.product.title).toBe(
      "Nike Air Max 1 Patta Waves Noise Aqua",
    );
    expect(payload.product.description).toContain("Authentic deadstock");
    expect(payload.product.imageUrls).toEqual([
      "https://img.example.com/1.jpg",
      "https://img.example.com/2.jpg",
    ]);
    expect(payload.product.aspects.Brand).toEqual(["Nike"]);
    expect(payload.product.aspects.Department).toEqual(["Men"]);
  });

  it("defaults quantity to 1 when absent", () => {
    const input = baseInput();
    input.draft.quantity = null;
    const payload = buildEbayInventoryItemPayload(input);
    expect(payload.availability.shipToLocationAvailability.quantity).toBe(1);
  });

  it("does not mutate its input", () => {
    const input = baseInput();
    const snapshot = JSON.stringify(input);
    buildEbayInventoryItemPayload(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("maps every used grade to the apparel-valid Pre-owned condition (USED_EXCELLENT/3000)", () => {
    // eBay US apparel/shoes/accessories categories only accept condition id 3000
    // ("Pre-owned") for used items. The media-only USED_VERY_GOOD/USED_GOOD/
    // USED_ACCEPTABLE (4000/5000/6000) are rejected at publishOffer (e.g. category
    // 57988 -> "Condition information 5000 ... is not a valid condition"), so all
    // used grades collapse to USED_EXCELLENT.
    for (const condition of ["used_excellent", "used_good", "used_fair"] as const) {
      const input = baseInput();
      input.item.condition = condition;
      expect(buildEbayInventoryItemPayload(input).condition).toBe("USED_EXCELLENT");
    }
  });

  it("maps the new conditions to their eBay enums", () => {
    const cases: Record<string, string> = {
      new_with_tags: "NEW_WITH_TAGS",
      new_without_tags: "NEW_WITHOUT_TAGS",
      for_parts: "FOR_PARTS_OR_NOT_WORKING",
    };
    for (const [condition, expected] of Object.entries(cases)) {
      const input = baseInput();
      input.item.condition = condition as typeof input.item.condition;
      expect(buildEbayInventoryItemPayload(input).condition).toBe(expected);
    }
  });
});

describe("buildEbayOfferPayload", () => {
  it("maps marketplace, price, category, policies and location", () => {
    const payload = buildEbayOfferPayload(baseInput());

    expect(payload.sku).toBe("percs0d1e2f3456784abc9def0123456789ab");
    expect(payload.marketplaceId).toBe("EBAY_US");
    expect(payload.format).toBe("FIXED_PRICE");
    expect(payload.categoryId).toBe("15709");
    expect(payload.availableQuantity).toBe(2);
    expect(payload.pricingSummary.price).toEqual({
      value: "240.00",
      currency: "USD",
    });
    expect(payload.listingPolicies).toEqual({
      paymentPolicyId: "pay-1",
      fulfillmentPolicyId: "ful-1",
      returnPolicyId: "ret-1",
    });
    expect(payload.merchantLocationKey).toBe("loc-1");
    expect(payload.listingDescription).toContain("Authentic deadstock");
  });

  it("never includes secret-looking fields", () => {
    const serialized = JSON.stringify(buildEbayOfferPayload(baseInput()));
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/authorization/i);
  });

  it("throws a typed error when a required field is missing", () => {
    const input = baseInput();
    input.draft.categoryId = null;
    expect(() => buildEbayOfferPayload(input)).toThrow(
      expect.objectContaining({ code: "EBAY_PUBLISH_FAILED" }),
    );
  });
});
