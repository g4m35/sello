import { describe, expect, it } from "vitest";

import { validateEbayListingReadiness } from "./listing-readiness";
import type { EbayListingReadinessInput } from "./listing-readiness";

function baseInput(): EbayListingReadinessInput {
  return {
    userId: "user-1",
    item: {
      id: "item-1",
      sellerId: "user-1",
      condition: "used_good",
    },
    draft: {
      title: "Nike Air Max 1 Patta Waves Noise Aqua",
      description: "Authentic pair in great condition. Ships fast from a smoke-free home.",
      priceCents: 24000,
      quantity: 1,
      categoryId: "15709",
    },
    photos: [{ url: "https://img.example.com/1.jpg" }],
    connection: { id: "conn-1" },
    sellerConfig: {
      paymentPolicyId: "pay-1",
      fulfillmentPolicyId: "ful-1",
      returnPolicyId: "ret-1",
      merchantLocationKey: "loc-1",
    },
  };
}

describe("validateEbayListingReadiness", () => {
  it("passes for a complete, owned, eBay-ready item", () => {
    const result = validateEbayListingReadiness(baseInput());
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects an item owned by another user", () => {
    const input = baseInput();
    input.item.sellerId = "someone-else";
    const result = validateEbayListingReadiness(input);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("item_ownership");
  });

  it("flags a missing title", () => {
    const input = baseInput();
    input.draft.title = "   ";
    const result = validateEbayListingReadiness(input);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("title");
  });

  it("blocks policy-unsafe non-sale wording before any eBay API call", () => {
    const input = baseInput();
    input.draft.title = "Sello Test Listing Do Not Buy";
    input.draft.description = "Placeholder item for testing.";
    const result = validateEbayListingReadiness(input);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("sale_wording");
  });

  it("flags a missing description", () => {
    const input = baseInput();
    input.draft.description = "";
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("description");
  });

  it("flags a non-positive price", () => {
    const input = baseInput();
    input.draft.priceCents = 0;
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("price");
  });

  it("flags an unknown condition", () => {
    const input = baseInput();
    input.item.condition = "unknown";
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("condition");
  });

  it("flags a missing categoryId", () => {
    const input = baseInput();
    input.draft.categoryId = null;
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("categoryId");
  });

  it("flags when there is no photo", () => {
    const input = baseInput();
    input.photos = [];
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("photo");
  });

  it("flags a missing eBay connection", () => {
    const input = baseInput();
    input.connection = null;
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("ebay_connection");
  });

  it("flags a missing seller config", () => {
    const input = baseInput();
    input.sellerConfig = null;
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toContain("seller_config");
  });

  it("flags each missing seller policy and location", () => {
    const input = baseInput();
    input.sellerConfig = {
      paymentPolicyId: null,
      fulfillmentPolicyId: null,
      returnPolicyId: null,
      merchantLocationKey: null,
    };
    const result = validateEbayListingReadiness(input);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "paymentPolicyId",
        "fulfillmentPolicyId",
        "returnPolicyId",
        "merchantLocationKey",
      ]),
    );
  });

  it("allows absent quantity because callers resolve the resale default to 1", () => {
    const input = baseInput();
    input.draft.quantity = null;
    const result = validateEbayListingReadiness(input);
    expect(result.ready).toBe(true);
    expect(result.missing).not.toContain("quantity");
    expect(result.warnings).not.toContain("quantity_defaulted_to_1");
  });
});
