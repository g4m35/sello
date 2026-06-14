import type { ItemCondition } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type { EbayMarketplaceId } from "./types";

// Pure mapping from internal inventory/draft data to eBay Inventory API
// payloads. No API calls, no secrets, no input mutation. Fixed-price,
// single-SKU only: no variations, no auction.

export type EbayMapperItem = {
  id: string;
  sellerId: string;
  brand: string | null;
  condition: ItemCondition;
  size: string | null;
  colorway: string | null;
  sku: string | null;
};

export type EbayMapperDraft = {
  title: string;
  description: string;
  priceCents: number;
  quantity: number | null;
  categoryId: string | null;
  itemSpecifics: Record<string, string>;
};

export type EbayMapperPhoto = {
  url: string | null;
};

export type EbayMapperSellerConfig = {
  marketplaceId: EbayMarketplaceId;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
};

export type EbayMapperInput = {
  item: EbayMapperItem;
  draft: EbayMapperDraft;
  photos: EbayMapperPhoto[];
  sellerConfig: EbayMapperSellerConfig;
};

export type EbayInventoryItemPayload = {
  availability: {
    shipToLocationAvailability: { quantity: number };
  };
  condition: string;
  product: {
    title: string;
    description: string;
    aspects: Record<string, string[]>;
    imageUrls: string[];
  };
};

export type EbayOfferPayload = {
  sku: string;
  marketplaceId: EbayMarketplaceId;
  format: "FIXED_PRICE";
  categoryId: string;
  availableQuantity: number;
  listingDescription: string;
  pricingSummary: {
    price: { value: string; currency: "USD" };
  };
  listingPolicies: {
    paymentPolicyId: string;
    fulfillmentPolicyId: string;
    returnPolicyId: string;
  };
  merchantLocationKey: string;
};

const conditionMap: Record<ItemCondition, string | null> = {
  new_with_tags: "NEW_WITH_TAGS",
  new_without_tags: "NEW_WITHOUT_TAGS",
  used_excellent: "USED_EXCELLENT",
  used_good: "USED_GOOD",
  used_fair: "USED_ACCEPTABLE",
  for_parts: "FOR_PARTS_OR_NOT_WORKING",
  unknown: null,
};

export function resolveEbaySku(item: EbayMapperItem): string {
  const existing = sanitizeEbaySku(item.sku);
  if (existing) return existing;
  const generated = sanitizeEbaySku(`percs${item.id}`);
  return generated || "percsitem";
}

function sanitizeEbaySku(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/[^a-zA-Z0-9]/g, "") ?? "";
  if (!cleaned) return null;
  return cleaned.slice(0, 50);
}

function requireField<T>(value: T | null | undefined, field: string): T {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    throw new EbayIntegrationError(
      ebayErrorCodes.publishFailed,
      `Cannot build eBay payload: missing required field "${field}".`,
      422,
      { field },
    );
  }
  return value;
}

function resolveQuantity(quantity: number | null): number {
  if (quantity === null || quantity === undefined) {
    return 1;
  }
  return quantity;
}

function buildAspects(input: EbayMapperInput): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input.draft.itemSpecifics)) {
    if (typeof value === "string" && value.trim().length > 0) {
      aspects[key] = [value];
    }
  }
  if (input.item.brand && input.item.brand.trim().length > 0) {
    aspects.Brand = [input.item.brand];
  }
  if (input.item.size && input.item.size.trim().length > 0) {
    aspects.Size = [input.item.size];
  }
  if (input.item.colorway && input.item.colorway.trim().length > 0) {
    aspects.Colorway = [input.item.colorway];
  }
  return aspects;
}

function imageUrls(photos: EbayMapperPhoto[]): string[] {
  return photos
    .map((photo) => photo.url)
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildEbayInventoryItemPayload(
  input: EbayMapperInput,
): EbayInventoryItemPayload {
  const condition = requireField(
    conditionMap[input.item.condition],
    "condition",
  );

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: resolveQuantity(input.draft.quantity),
      },
    },
    condition,
    product: {
      title: requireField(input.draft.title, "title"),
      description: requireField(input.draft.description, "description"),
      aspects: buildAspects(input),
      imageUrls: imageUrls(input.photos),
    },
  };
}

export function buildEbayOfferPayload(input: EbayMapperInput): EbayOfferPayload {
  const priceCents = input.draft.priceCents;
  if (
    typeof priceCents !== "number" ||
    !Number.isFinite(priceCents) ||
    priceCents <= 0
  ) {
    throw new EbayIntegrationError(
      ebayErrorCodes.publishFailed,
      'Cannot build eBay payload: missing required field "price".',
      422,
      { field: "price" },
    );
  }

  return {
    sku: resolveEbaySku(input.item),
    marketplaceId: input.sellerConfig.marketplaceId,
    format: "FIXED_PRICE",
    categoryId: requireField(input.draft.categoryId, "categoryId"),
    availableQuantity: resolveQuantity(input.draft.quantity),
    listingDescription: requireField(input.draft.description, "description"),
    pricingSummary: {
      price: { value: centsToAmount(priceCents), currency: "USD" },
    },
    listingPolicies: {
      paymentPolicyId: requireField(input.sellerConfig.paymentPolicyId, "paymentPolicyId"),
      fulfillmentPolicyId: requireField(
        input.sellerConfig.fulfillmentPolicyId,
        "fulfillmentPolicyId",
      ),
      returnPolicyId: requireField(input.sellerConfig.returnPolicyId, "returnPolicyId"),
    },
    merchantLocationKey: requireField(
      input.sellerConfig.merchantLocationKey,
      "merchantLocationKey",
    ),
  };
}
