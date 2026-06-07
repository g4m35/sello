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
  it("uses the existing SKU when present", () => {
    const input = baseInput();
    input.item.sku = "custom-sku-123";
    expect(resolveEbaySku(input.item)).toBe("custom-sku-123");
  });

  it("derives a deterministic SKU from the inventory item id", () => {
    const input = baseInput();
    expect(resolveEbaySku(input.item)).toBe(
      "percs_0d1e2f34-5678-4abc-9def-0123456789ab",
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
});

describe("buildEbayOfferPayload", () => {
  it("maps marketplace, price, category, policies and location", () => {
    const payload = buildEbayOfferPayload(baseInput());

    expect(payload.sku).toBe("percs_0d1e2f34-5678-4abc-9def-0123456789ab");
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
