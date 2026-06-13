import type { ItemCondition } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  resolveEbayAspects,
  type EbayAspectRequirement,
} from "@/lib/listing/ebay-aspects";
import {
  analyzeListing,
  type EbayCategoryResolution,
  type ListingIntelligence,
} from "@/lib/listing/intelligence";

import {
  getEbayEnvironment,
  isEbayProductionPublishEnabled,
  isEbaySandboxPublishEnabled,
} from "./config";
import {
  validateEbayListingReadiness,
  type EbayListingReadinessResult,
} from "./listing-readiness";
import {
  buildEbayInventoryItemPayload,
  buildEbayOfferPayload,
  resolveEbaySku,
  type EbayInventoryItemPayload,
  type EbayOfferPayload,
} from "./mapper";
import type { EbayEnvironment, EbayMarketplaceId } from "./types";

// Publish preflight (dry run). Validates a listing against the exact same
// rules and payload builders the real publish flow uses and shows what WOULD be
// sent to eBay, but performs zero outbound network calls of any kind: no token
// resolution, no eBay client, no fetch. This module can never create a listing.

type EbayEnv = Record<string, string | undefined>;

type DraftRow = {
  title: string | null;
  description: string | null;
  recommendedPriceCents: number | null;
  itemSpecifics: unknown;
  marketplaceDrafts: unknown;
};

type ItemRow = {
  id: string;
  sellerId: string;
  productName?: string;
  brand: string | null;
  category?: string;
  condition: ItemCondition;
  size: string | null;
  colorway: string | null;
  listingDrafts: DraftRow[];
  photos: { storageBucket: string; storagePath: string }[];
};

export type EbayPreflightPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; sellerId: string };
      include?: unknown;
    }): Promise<ItemRow | null>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        userId_marketplace_environment: {
          userId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
      };
    }): Promise<{ id: string } | null>;
  };
  ebaySellerConfig: {
    findFirst(args: {
      where: { userId: string; marketplaceConnectionId: string };
    }): Promise<{
      marketplaceId: string;
      paymentPolicyId: string | null;
      fulfillmentPolicyId: string | null;
      returnPolicyId: string | null;
      merchantLocationKey: string | null;
    } | null>;
  };
};

export type EbayPreflightResult = {
  marketplace: "ebay";
  environment: EbayEnvironment;
  mode: "dry_run";
  /** Whether a real publish is currently possible at all (always false in production). */
  publishingEnabled: boolean;
  connected: boolean;
  ready: boolean;
  missing: string[];
  warnings: string[];
  /** How the eBay category was resolved (saved override, inference, or open choice). */
  category: EbayCategoryResolution;
  itemType: ListingIntelligence["itemType"];
  measurementProfile: ListingIntelligence["measurementProfile"];
  /** Explicit listing quantity (resale default 1, never a hidden assumption). */
  quantity: number;
  /** Required/recommended eBay item specifics for the resolved category. */
  aspects: {
    values: Record<string, string>;
    missingRequired: EbayAspectRequirement[];
    missingRecommended: EbayAspectRequirement[];
  };
  preview: {
    sku: string;
    steps: ["createOrReplaceInventoryItem", "createOffer", "publishOffer"];
    inventoryItem: EbayInventoryItemPayload;
    offer: EbayOfferPayload;
  } | null;
};

export type EbayPreflightInput = {
  userId: string;
  inventoryItemId: string;
};

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function ebayDraftFields(draft: DraftRow | undefined): {
  categoryId: string | null;
  quantity: number | null;
  aspects: Record<string, string>;
} {
  if (!draft || !draft.marketplaceDrafts || typeof draft.marketplaceDrafts !== "object") {
    return { categoryId: null, quantity: null, aspects: {} };
  }
  const ebay = (draft.marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") {
    return { categoryId: null, quantity: null, aspects: {} };
  }
  const record = ebay as Record<string, unknown>;
  return {
    categoryId: typeof record.categoryId === "string" ? record.categoryId : null,
    quantity: typeof record.quantity === "number" ? record.quantity : null,
    aspects: asStringRecord(record.aspects),
  };
}

function resolvePhotoUrl(
  photo: { storageBucket: string; storagePath: string },
  env: EbayEnv,
): string | null {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || base.trim().length === 0) {
    return null;
  }
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/storage/v1/object/public/${photo.storageBucket}/${photo.storagePath}`;
}

export async function preflightEbayListing(
  prisma: EbayPreflightPrismaLike,
  input: EbayPreflightInput,
  env: EbayEnv = process.env,
): Promise<EbayPreflightResult> {
  const environment = getEbayEnvironment(env);
  // Preflight is zero-write; this only reports whether the matching publish
  // route would be enabled after all readiness checks pass.
  const publishingEnabled =
    environment === "production"
      ? isEbayProductionPublishEnabled(env)
      : isEbaySandboxPublishEnabled(env);

  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: input.userId },
    include: {
      listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      photos: { orderBy: { position: "asc" } },
    },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      userId_marketplace_environment: {
        userId: input.userId,
        marketplace: "ebay",
        environment,
      },
    },
  });

  const sellerConfig = connection
    ? await prisma.ebaySellerConfig.findFirst({
        where: { userId: input.userId, marketplaceConnectionId: connection.id },
      })
    : null;

  const draft = item.listingDrafts[0];
  const { categoryId: savedCategoryId, quantity, aspects: savedAspects } =
    ebayDraftFields(draft);
  const photos = item.photos.map((photo) => ({
    url: resolvePhotoUrl(photo, env),
  }));

  // Listing intelligence: sellers should never need raw eBay category IDs.
  // A saved override always wins; otherwise a high-confidence inference is
  // used; otherwise the dry run blocks with suggestions to choose from.
  const intelligence = analyzeListing({
    title: draft?.title ?? item.productName ?? null,
    brand: item.brand,
    description: draft?.description ?? null,
    productCategory: item.category ?? null,
    size: item.size,
    itemSpecifics: asStringRecord(draft?.itemSpecifics),
    tags: [],
    savedEbayCategoryId: savedCategoryId,
  });
  const categoryId = intelligence.ebayCategory.resolvedId;

  // Required item specifics for the resolved category, satisfied from data
  // Sello already has (brand, size, color, inferred department, saved aspect
  // answers); only the genuinely unknown remain for the seller.
  const aspects = resolveEbayAspects(categoryId, {
    brand: item.brand,
    size: item.size,
    colorway: item.colorway,
    department: intelligence.department,
    measurementProfile: intelligence.measurementProfile,
    itemSpecifics: asStringRecord(draft?.itemSpecifics),
    savedAspects,
  });

  // Resale default: one of each item. Explicit, never a hidden assumption.
  const resolvedQuantity = quantity ?? 1;

  const readiness: EbayListingReadinessResult = validateEbayListingReadiness({
    userId: input.userId,
    item: { id: item.id, sellerId: item.sellerId, condition: item.condition },
    draft: {
      title: draft?.title ?? null,
      description: draft?.description ?? null,
      priceCents: draft?.recommendedPriceCents ?? null,
      quantity: resolvedQuantity,
      categoryId,
    },
    photos,
    connection: connection ? { id: connection.id } : null,
    sellerConfig,
  });

  const missingAspectIds =
    aspects.missingRequired.length > 0 ? ["ebay_aspects"] : [];

  if (!readiness.ready || missingAspectIds.length > 0) {
    return {
      marketplace: "ebay",
      environment,
      mode: "dry_run",
      publishingEnabled,
      connected: Boolean(connection),
      ready: false,
      // "categoryId" is the validator's internal id; sellers see a category
      // CHOICE (with suggestions), not a raw marketplace ID problem.
      missing: [
        ...readiness.missing.map((id) =>
          id === "categoryId" ? "ebay_category" : id,
        ),
        ...missingAspectIds,
      ],
      warnings: readiness.warnings,
      category: intelligence.ebayCategory,
      itemType: intelligence.itemType,
      measurementProfile: intelligence.measurementProfile,
      quantity: resolvedQuantity,
      aspects,
      preview: null,
    };
  }

  // Readiness guarantees draft and sellerConfig are present and complete.
  const checkedConfig = sellerConfig!;
  const checkedDraft = draft!;
  const mapperInput = {
    item: {
      id: item.id,
      sellerId: item.sellerId,
      brand: item.brand,
      condition: item.condition,
      size: item.size,
      colorway: item.colorway,
      sku: null,
    },
    draft: {
      title: checkedDraft.title!,
      description: checkedDraft.description!,
      priceCents: checkedDraft.recommendedPriceCents!,
      quantity: resolvedQuantity,
      categoryId,
      // Resolved aspects (Department, US Shoe Size, etc.) ride along as item
      // specifics so the payload preview shows exactly what would be sent.
      itemSpecifics: {
        ...asStringRecord(checkedDraft.itemSpecifics),
        ...aspects.values,
      },
    },
    photos,
    sellerConfig: {
      marketplaceId: checkedConfig.marketplaceId as EbayMarketplaceId,
      paymentPolicyId: checkedConfig.paymentPolicyId,
      fulfillmentPolicyId: checkedConfig.fulfillmentPolicyId,
      returnPolicyId: checkedConfig.returnPolicyId,
      merchantLocationKey: checkedConfig.merchantLocationKey,
    },
  };

  return {
    marketplace: "ebay",
    environment,
    mode: "dry_run",
    publishingEnabled,
    connected: true,
    ready: true,
    missing: [],
    warnings: readiness.warnings,
    category: intelligence.ebayCategory,
    itemType: intelligence.itemType,
    measurementProfile: intelligence.measurementProfile,
    quantity: resolvedQuantity,
    aspects,
    preview: {
      sku: resolveEbaySku(mapperInput.item),
      steps: ["createOrReplaceInventoryItem", "createOffer", "publishOffer"],
      inventoryItem: buildEbayInventoryItemPayload(mapperInput),
      offer: buildEbayOfferPayload(mapperInput),
    },
  };
}
