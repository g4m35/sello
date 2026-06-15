import { describe, expect, it } from "vitest";

import type { EbayPreflightResult } from "./preflight";
import {
  buildEbayPublishReview,
  canSubmitLiveEbayPublish,
} from "./publish-review";

function readyPreflight(
  overrides: Partial<EbayPreflightResult> = {},
): EbayPreflightResult {
  return {
    marketplace: "ebay",
    environment: "production",
    mode: "dry_run",
    publishingEnabled: true,
    connected: true,
    ready: true,
    missing: [],
    warnings: [],
    category: {
      resolvedId: "15709",
      resolvedName: "Men's Athletic Shoes",
      source: "inferred",
      confidence: "high",
      suggestions: [],
    },
    itemType: "sneakers",
    measurementProfile: "shoes",
    quantity: 1,
    aspects: { source: "local", values: {}, missingRequired: [], missingRecommended: [] },
    preview: {
      sku: "percs_item-1",
      steps: ["createOrReplaceInventoryItem", "createOffer", "publishOffer"],
      inventoryItem: {
        availability: { shipToLocationAvailability: { quantity: 1 } },
        condition: "NEW_WITH_TAGS",
        product: {
          title: "Nike Air Max 1 Aqua",
          description: "Clean pair.",
          aspects: { Brand: ["Nike"], Size: ["US 10"] },
          imageUrls: ["https://example.test/p.jpg"],
        },
      },
      offer: {
        sku: "percs_item-1",
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        categoryId: "15709",
        availableQuantity: 1,
        listingDescription: "Clean pair.",
        pricingSummary: { price: { value: "240.00", currency: "USD" } },
        listingPolicies: {
          paymentPolicyId: "pay-123",
          fulfillmentPolicyId: "ful-123",
          returnPolicyId: "ret-123",
        },
        merchantLocationKey: "loc-main",
      },
    },
    ...overrides,
  };
}

describe("buildEbayPublishReview", () => {
  it("derives the review payload directly from the preflight preview (no drift)", () => {
    const preflight = readyPreflight();
    const result = buildEbayPublishReview(preflight);

    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("expected ready review");

    const { review } = result;
    // Every field traces back to exactly what the publish flow would send.
    expect(review.marketplaceLabel).toBe("eBay (Production)");
    expect(review.environment).toBe("production");
    expect(review.title).toBe(preflight.preview!.inventoryItem.product.title);
    expect(review.priceLabel).toBe("$240.00");
    expect(review.categoryLabel).toBe("Men's Athletic Shoes / 15709");
    expect(review.quantity).toBe(preflight.preview!.offer.availableQuantity);
    expect(review.conditionLabel).toBe("New with tags");
    expect(review.policies.payment).toBe(
      preflight.preview!.offer.listingPolicies.paymentPolicyId,
    );
    expect(review.policies.fulfillment).toBe(
      preflight.preview!.offer.listingPolicies.fulfillmentPolicyId,
    );
    expect(review.policies.return).toBe(
      preflight.preview!.offer.listingPolicies.returnPolicyId,
    );
    expect(review.location).toBe(preflight.preview!.offer.merchantLocationKey);
  });

  it("labels a sandbox dry run as sandbox", () => {
    const result = buildEbayPublishReview(
      readyPreflight({ environment: "sandbox" }),
    );
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("expected ready review");
    expect(result.review.marketplaceLabel).toBe("eBay (Sandbox)");
  });

  it("returns not-ready with the preflight's missing blockers when the listing is incomplete", () => {
    const result = buildEbayPublishReview(
      readyPreflight({
        ready: false,
        preview: null,
        missing: ["ebay_category", "merchantLocationKey"],
      }),
    );
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("expected not-ready review");
    expect(result.missing).toEqual(["ebay_category", "merchantLocationKey"]);
  });
});

describe("canSubmitLiveEbayPublish", () => {
  it("requires both a ready review and an explicit confirmation", () => {
    expect(canSubmitLiveEbayPublish({ reviewReady: true, confirmed: true })).toBe(
      true,
    );
    expect(
      canSubmitLiveEbayPublish({ reviewReady: true, confirmed: false }),
    ).toBe(false);
    expect(
      canSubmitLiveEbayPublish({ reviewReady: false, confirmed: true }),
    ).toBe(false);
    expect(
      canSubmitLiveEbayPublish({ reviewReady: false, confirmed: false }),
    ).toBe(false);
  });
});
