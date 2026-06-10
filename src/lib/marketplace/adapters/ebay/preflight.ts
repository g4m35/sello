import type { ItemCondition } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

import { getEbayEnvironment, isEbaySandboxPublishEnabled } from "./config";
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

// Production publish PREFLIGHT (dry run). Validates a listing against the
// exact same rules and payload builders the real publish flow uses and shows
// what WOULD be sent to eBay, but performs zero outbound network calls of any
// kind: no token resolution, no eBay client, no fetch. The production publish
// hard-lock in publish.ts is intentionally untouched; this module can never
// create a listing. The data-loading mirrors publishEbayListing on purpose
// (kept separate so the guarded sandbox publish path is not modified at all).

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
  brand: string | null;
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
} {
  if (!draft || !draft.marketplaceDrafts || typeof draft.marketplaceDrafts !== "object") {
    return { categoryId: null, quantity: null };
  }
  const ebay = (draft.marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") {
    return { categoryId: null, quantity: null };
  }
  const record = ebay as Record<string, unknown>;
  return {
    categoryId: typeof record.categoryId === "string" ? record.categoryId : null,
    quantity: typeof record.quantity === "number" ? record.quantity : null,
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
  // Production publishing is hard-disabled; sandbox follows its explicit flag.
  const publishingEnabled =
    environment === "sandbox" && isEbaySandboxPublishEnabled(env);

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
  const { categoryId, quantity } = ebayDraftFields(draft);
  const photos = item.photos.map((photo) => ({
    url: resolvePhotoUrl(photo, env),
  }));

  const readiness: EbayListingReadinessResult = validateEbayListingReadiness({
    userId: input.userId,
    item: { id: item.id, sellerId: item.sellerId, condition: item.condition },
    draft: {
      title: draft?.title ?? null,
      description: draft?.description ?? null,
      priceCents: draft?.recommendedPriceCents ?? null,
      quantity,
      categoryId,
    },
    photos,
    connection: connection ? { id: connection.id } : null,
    sellerConfig,
  });

  if (!readiness.ready) {
    return {
      marketplace: "ebay",
      environment,
      mode: "dry_run",
      publishingEnabled,
      connected: Boolean(connection),
      ready: false,
      missing: readiness.missing,
      warnings: readiness.warnings,
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
      quantity,
      categoryId,
      itemSpecifics: asStringRecord(checkedDraft.itemSpecifics),
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
    preview: {
      sku: resolveEbaySku(mapperInput.item),
      steps: ["createOrReplaceInventoryItem", "createOffer", "publishOffer"],
      inventoryItem: buildEbayInventoryItemPayload(mapperInput),
      offer: buildEbayOfferPayload(mapperInput),
    },
  };
}
