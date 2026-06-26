import type { ItemCondition } from "@/generated/prisma/client";

// Pure, local listing readiness validation. Performs no network calls; it only
// inspects already-loaded item, draft, photo, connection, and seller-config
// data. The publish flow must call this before any eBay API request so that an
// incomplete listing produces zero outbound calls.

export type EbayReadinessItem = {
  id: string;
  sellerId: string;
  condition: ItemCondition;
};

export type EbayReadinessDraft = {
  title: string | null;
  description: string | null;
  priceCents: number | null;
  quantity: number | null;
  categoryId: string | null;
};

export type EbayReadinessPhoto = {
  url: string | null;
};

export type EbayReadinessConnection = {
  id: string;
} | null;

export type EbayReadinessSellerConfig = {
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
} | null;

export type EbayListingReadinessInput = {
  userId: string;
  item: EbayReadinessItem;
  draft: EbayReadinessDraft;
  photos: EbayReadinessPhoto[];
  connection: EbayReadinessConnection;
  sellerConfig: EbayReadinessSellerConfig;
};

export type EbayListingReadinessResult = {
  ready: boolean;
  missing: string[];
  warnings: string[];
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const unsafeSaleWordingPatterns = [
  /\btest\b/i,
  /do\s+not\s+buy/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /\bplaceholder\b/i,
  /not\s+for\s+sale/i,
];

function hasUnsafeSaleWording(...values: Array<string | null | undefined>) {
  const text = values.filter(hasText).join(" ");
  return unsafeSaleWordingPatterns.some((pattern) => pattern.test(text));
}

export function validateEbayListingReadiness(
  input: EbayListingReadinessInput,
): EbayListingReadinessResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!hasText(input.draft.title)) {
    missing.push("title");
  }

  if (!hasText(input.draft.description)) {
    missing.push("description");
  }

  if (hasUnsafeSaleWording(input.draft.title, input.draft.description)) {
    missing.push("sale_wording");
  }

  if (
    typeof input.draft.priceCents !== "number" ||
    !Number.isFinite(input.draft.priceCents) ||
    input.draft.priceCents <= 0
  ) {
    missing.push("price");
  }

  if (input.item.condition === "unknown") {
    missing.push("condition");
  }

  if (!hasText(input.draft.categoryId)) {
    missing.push("categoryId");
  }

  const hasPhoto = input.photos.some((photo) => hasText(photo.url));
  if (!hasPhoto) {
    missing.push("photo");
  }

  if (
    input.draft.quantity !== null &&
    input.draft.quantity !== undefined &&
    (!Number.isInteger(input.draft.quantity) || input.draft.quantity <= 0)
  ) {
    missing.push("quantity");
  }

  if (!input.connection) {
    missing.push("ebay_connection");
  }

  if (!input.sellerConfig) {
    missing.push("seller_config");
  } else {
    if (!hasText(input.sellerConfig.paymentPolicyId)) {
      missing.push("paymentPolicyId");
    }
    if (!hasText(input.sellerConfig.fulfillmentPolicyId)) {
      missing.push("fulfillmentPolicyId");
    }
    if (!hasText(input.sellerConfig.returnPolicyId)) {
      missing.push("returnPolicyId");
    }
    if (!hasText(input.sellerConfig.merchantLocationKey)) {
      missing.push("merchantLocationKey");
    }
  }

  return { ready: missing.length === 0, missing, warnings };
}
