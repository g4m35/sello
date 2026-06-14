import type { EbayPreflightResult } from "./preflight";

// Pure, view-only mapping from an eBay preflight (dry-run) result into the
// human final-review shown before a live publish. It performs no I/O and never
// publishes. Because the review is derived from the SAME payload the publish
// flow would send (preflight.preview), what the seller confirms is exactly what
// eBay receives: the review can never drift from the real request.

export type EbayPublishReview = {
  /** e.g. "eBay (Production)" — the channel and environment being created on. */
  marketplaceLabel: string;
  environment: "sandbox" | "production";
  title: string;
  /** Formatted price, e.g. "$240.00". */
  priceLabel: string;
  /** Human category, e.g. "Men's Athletic Shoes / 15709". */
  categoryLabel: string;
  quantity: number;
  /** Human eBay condition, e.g. "New with tags". */
  conditionLabel: string;
  policies: {
    payment: string;
    fulfillment: string;
    return: string;
  };
  /** eBay merchant location key (inventory location). */
  location: string;
};

export type EbayPublishReviewResult =
  | { ready: true; review: EbayPublishReview }
  | { ready: false; missing: string[] };

const conditionLabels: Record<string, string> = {
  NEW_WITH_TAGS: "New with tags",
  NEW_WITHOUT_TAGS: "New without tags",
  NEW: "New",
  USED_EXCELLENT: "Used (excellent)",
  USED_VERY_GOOD: "Used (very good)",
  USED_GOOD: "Used (good)",
  USED_ACCEPTABLE: "Used (acceptable)",
  FOR_PARTS_OR_NOT_WORKING: "For parts / not working",
};

function conditionLabelFor(condition: string): string {
  return conditionLabels[condition] ?? condition;
}

function priceLabelFor(value: string, currency: string): string {
  return currency === "USD" ? `$${value}` : `${value} ${currency}`;
}

function categoryLabelFor(
  category: EbayPreflightResult["category"],
  fallbackId: string,
): string {
  const id = category.resolvedId ?? fallbackId;
  return category.resolvedName ? `${category.resolvedName} / ${id}` : id;
}

function environmentLabel(environment: "sandbox" | "production"): string {
  return environment === "production" ? "Production" : "Sandbox";
}

// Builds the final-review view-model. Returns { ready: false } with the same
// blocker ids the preflight reported when the listing is not publishable, so
// the UI can refuse to publish and show exactly what is missing.
export function buildEbayPublishReview(
  preflight: EbayPreflightResult,
): EbayPublishReviewResult {
  if (!preflight.ready || !preflight.preview) {
    return { ready: false, missing: preflight.missing };
  }

  const { offer, inventoryItem } = preflight.preview;

  return {
    ready: true,
    review: {
      marketplaceLabel: `eBay (${environmentLabel(preflight.environment)})`,
      environment: preflight.environment,
      title: inventoryItem.product.title,
      priceLabel: priceLabelFor(
        offer.pricingSummary.price.value,
        offer.pricingSummary.price.currency,
      ),
      categoryLabel: categoryLabelFor(preflight.category, offer.categoryId),
      quantity: offer.availableQuantity,
      conditionLabel: conditionLabelFor(inventoryItem.condition),
      policies: {
        payment: offer.listingPolicies.paymentPolicyId,
        fulfillment: offer.listingPolicies.fulfillmentPolicyId,
        return: offer.listingPolicies.returnPolicyId,
      },
      location: offer.merchantLocationKey,
    },
  };
}

// The single rule that lets a live eBay publish proceed from the review UI:
// the preflight review must be ready AND the seller must have explicitly
// confirmed they are creating a live listing. Pure so the gate is unit-tested
// independently of the modal.
export function canSubmitLiveEbayPublish(args: {
  reviewReady: boolean;
  confirmed: boolean;
}): boolean {
  return args.reviewReady && args.confirmed;
}
