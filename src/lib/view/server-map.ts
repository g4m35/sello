// Server-only: imported exclusively by API route handlers. Maps Prisma rows
// into the UI view-model DTOs.
import type {
  InventoryItem,
  ItemPhoto,
  ListingDraft,
  MarketplaceListing,
  PublishAttempt,
} from "@/generated/prisma/client";
import { parseFlaws, parseMeasurements } from "@/lib/ai/listing-draft";
import { safeFailureText } from "@/lib/errors";
import { describeState, toLifecycleState } from "@/lib/lifecycle/item-status";
import {
  getEbayEnvironment,
  isEbayProductionPublishEnabled,
} from "@/lib/marketplace/adapters/ebay/config";
import { isStockXListingCreationAvailable } from "@/lib/marketplace/adapters/stockx/capabilities";
import { listMarketplaceAdapters } from "@/lib/marketplace/adapter";
import { marketplaceName } from "@/lib/view/marketplaces";
import { buildReadinessView } from "@/lib/view/readiness-view";
import {
  designStatusFromAttempt,
  designStatusFromInventory,
  designStatusFromListing,
} from "@/lib/view/status";
import type {
  AttemptView,
  ChannelStateView,
  ItemDetailView,
  ItemView,
} from "@/lib/view/types";

const ADAPTER_PUBLISH = new Map(
  listMarketplaceAdapters().map((a) => [a.marketplace as string, a.capabilities.publish]),
);

function publishImplementedForView(
  marketplace: string,
  draft: ListingDraft | null = null,
): boolean {
  if (marketplace === "ebay") {
    if (getEbayEnvironment() === "production") {
      return isEbayProductionPublishEnabled();
    }
    return ADAPTER_PUBLISH.get(marketplace) ?? false;
  }
  if (marketplace === "stockx") {
    return (
      isStockXListingCreationAvailable() &&
      hasText(draft?.stockxProductId) &&
      hasText(draft?.stockxVariantId)
    );
  }
  return ADAPTER_PUBLISH.get(marketplace) ?? false;
}

type ItemWithRelations = InventoryItem & {
  listingDrafts: ListingDraft[];
  marketplaceListings: MarketplaceListing[];
  photos?: ItemPhoto[];
  _count?: { photos: number };
};

function latestDraft(item: ItemWithRelations): ListingDraft | null {
  if (!item.listingDrafts.length) return null;
  return [...item.listingDrafts].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )[0];
}

function photoCountOf(item: ItemWithRelations): number {
  if (item._count?.photos != null) return item._count.photos;
  if (item.photos) return item.photos.length;
  return 0;
}

function channelsOf(item: ItemWithRelations, draft: ListingDraft | null): ChannelStateView[] {
  const byMarketplace = new Map(
    item.marketplaceListings.map((l) => [l.marketplace as string, l]),
  );
  const selected = new Set((draft?.selectedMarketplaces ?? []) as string[]);

  return listMarketplaceAdapters().map((adapter) => {
    const mp = adapter.marketplace as string;
    const listing = byMarketplace.get(mp);
    let status: ChannelStateView["status"];
    if (listing) {
      status = designStatusFromListing(listing.status);
    } else if (selected.has(mp)) {
      status = "ready";
    } else {
      status = "draft";
    }
    return {
      marketplace: mp,
      name: adapter.displayName,
      status,
      publishImplemented: publishImplementedForView(mp, draft),
      environment: listing?.environment ?? null,
      sku: listing?.sku ?? null,
      externalOfferId: listing?.externalOfferId ?? null,
      externalListingId: listing?.externalListingId ?? null,
      externalUrl: listing?.externalUrl ?? null,
      lastError: safeRenderFailure(listing?.lastError),
    };
  });
}

export function mapItem(item: ItemWithRelations): ItemView {
  const draft = latestDraft(item);
  const lifecycleState = toLifecycleState(item.status);
  const priceCents = draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null;
  // Readiness on the list view-model lets dashboard/inventory tell a complete
  // draft (mark ready) from an incomplete one (needs details) without a detail fetch.
  const readiness = buildReadinessView({
    productName: item.productName,
    title: draft?.title ?? "",
    description: draft?.description ?? "",
    bulletPoints: draft?.bulletPoints ?? [],
    selectedMarketplaces: (draft?.selectedMarketplaces ?? []) as string[],
    recommendedPriceCents: priceCents,
    photoCount: photoCountOf(item),
    condition: item.condition,
    productCategory: item.category ?? null,
    brand: item.brand,
    size: item.size,
    colorway: item.colorway,
    itemSpecifics: itemSpecificsOf(draft?.itemSpecifics),
    savedEbayCategoryId: ebayCategoryIdOf(draft?.marketplaceDrafts),
    savedAspects: ebayAspectsOf(draft?.marketplaceDrafts),
    savedQuantity: ebaySavedQuantityOf(draft?.marketplaceDrafts),
  });
  const missingCount = readiness.checks.filter(
    (check) => check.blocking && check.state === "miss",
  ).length;
  return {
    id: item.id,
    title: draft?.title || item.productName,
    productName: item.productName,
    brand: item.brand,
    category: item.category,
    condition: item.condition,
    size: item.size,
    colorway: item.colorway,
    priceCents,
    status: designStatusFromInventory(item.status),
    lifecycleState,
    statusLabel: describeState(lifecycleState).label,
    ready: readiness.ready,
    missingCount,
    photoCount: photoCountOf(item),
    updatedAt: item.updatedAt.toISOString(),
    draftId: draft?.id ?? null,
    channels: channelsOf(item, draft),
  };
}

export function mapItemDetail(
  item: ItemWithRelations & { photos: ItemPhoto[] },
  attempts: AttemptView[],
  photoUrls: Map<string, string | null> = new Map(),
): ItemDetailView {
  const base = mapItem(item);
  const draft = latestDraft(item);
  const photos = [...item.photos]
    .sort((a, b) => a.position - b.position)
    .map((p) => ({ id: p.id, position: p.position, url: photoUrls.get(p.id) ?? null }));

  const readiness = buildReadinessView({
    productName: item.productName,
    title: draft?.title ?? "",
    description: draft?.description ?? "",
    bulletPoints: draft?.bulletPoints ?? [],
    selectedMarketplaces: (draft?.selectedMarketplaces ?? []) as string[],
    recommendedPriceCents: base.priceCents,
    photoCount: photos.length,
    condition: item.condition,
    productCategory: item.category ?? null,
    brand: item.brand,
    size: item.size,
    colorway: item.colorway,
    itemSpecifics: itemSpecificsOf(draft?.itemSpecifics),
    savedEbayCategoryId: ebayCategoryIdOf(draft?.marketplaceDrafts),
    savedAspects: ebayAspectsOf(draft?.marketplaceDrafts),
    savedQuantity: ebaySavedQuantityOf(draft?.marketplaceDrafts),
  });

  return {
    ...base,
    sku: item.styleCode,
    description: draft?.description ?? "",
    bulletPoints: draft?.bulletPoints ?? [],
    pricingRationale: draft?.pricingRationale ?? item.pricingRationale ?? null,
    measurements: parseMeasurements(draft?.measurements),
    flaws: parseFlaws(draft?.flaws),
    ebayCategoryId: ebayCategoryIdOf(draft?.marketplaceDrafts),
    ebayQuantity: ebayQuantityOf(draft?.marketplaceDrafts),
    ebayAspects: ebayAspectsOf(draft?.marketplaceDrafts),
    stockxMatch: stockxMatchOf(draft),
    selectedMarketplaces: (draft?.selectedMarketplaces ?? []) as string[],
    readiness,
    attempts,
    photos,
  };
}

function stockxMatchOf(draft: ListingDraft | null): ItemDetailView["stockxMatch"] {
  const json = stockxDraftOf(draft?.marketplaceDrafts);
  const productId = draft?.stockxProductId ?? stringOf(json.productId);
  const variantId = draft?.stockxVariantId ?? stringOf(json.variantId);
  const size = stringOf(json.size);
  const marketDataStatus = stringOf(json.marketDataStatus);
  const status =
    !productId
      ? "not_matched"
      : !variantId || !size
        ? "needs_variant"
        : marketDataStatus === "unavailable"
          ? "market_data_unavailable"
          : "matched";

  return {
    status,
    productId,
    variantId,
    title: stringOf(json.title),
    brand: stringOf(json.brand),
    model: stringOf(json.model),
    style: stringOf(json.style),
    colorway: stringOf(json.colorway),
    color: stringOf(json.color),
    size,
    image: stringOf(json.image),
    category: stringOf(json.category),
    url: stringOf(json.url),
    matchSource: draft?.stockxMatchSource ?? stringOf(json.matchSource),
    matchConfidence:
      draft?.stockxMatchConfidence ??
      (typeof json.matchConfidence === "number" ? json.matchConfidence : null),
    marketDataCheckedAt: draft?.stockxMarketDataCheckedAt?.toISOString() ?? null,
  };
}

function stockxDraftOf(marketplaceDrafts: unknown): Record<string, unknown> {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return {};
  const stockx = (marketplaceDrafts as Record<string, unknown>).stockx;
  if (!stockx || typeof stockx !== "object" || Array.isArray(stockx)) return {};
  return stockx as Record<string, unknown>;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function ebayAspectsOf(marketplaceDrafts: unknown): Record<string, string> {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return {};
  const ebay = (marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") return {};
  const aspects = (ebay as Record<string, unknown>).aspects;
  if (!aspects || typeof aspects !== "object" || Array.isArray(aspects)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(aspects as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

function ebayQuantityOf(marketplaceDrafts: unknown): number {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return 1;
  const ebay = (marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") return 1;
  const quantity = (ebay as Record<string, unknown>).quantity;
  return Number.isInteger(quantity) && (quantity as number) > 0
    ? (quantity as number)
    : 1;
}

// Raw saved quantity (null when never set) so readiness can distinguish "default
// of 1" from an explicit invalid value, instead of silently coercing.
function ebaySavedQuantityOf(marketplaceDrafts: unknown): number | null {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return null;
  const ebay = (marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") return null;
  const quantity = (ebay as Record<string, unknown>).quantity;
  return typeof quantity === "number" ? quantity : null;
}

function itemSpecificsOf(itemSpecifics: unknown): Record<string, string> {
  if (!itemSpecifics || typeof itemSpecifics !== "object" || Array.isArray(itemSpecifics)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(itemSpecifics as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

function ebayCategoryIdOf(marketplaceDrafts: unknown): string | null {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return null;
  const ebay = (marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") return null;
  const categoryId = (ebay as Record<string, unknown>).categoryId;
  return typeof categoryId === "string" && categoryId.length > 0 ? categoryId : null;
}

type AttemptWithRelations = PublishAttempt & {
  marketplaceListing: MarketplaceListing & {
    inventoryItem: InventoryItem & { listingDrafts: ListingDraft[] };
  };
};

// Defense in depth for the debug/admin marketplace panels: even if an older row
// persisted a raw failure string, scrub it on the way out. Keeps null as null.
function safeRenderFailure(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return safeFailureText(value);
}

export function mapAttempt(attempt: AttemptWithRelations): AttemptView {
  const listing = attempt.marketplaceListing;
  const item = listing.inventoryItem;
  const draft = item.listingDrafts[0];
  const mp = listing.marketplace as string;
  const adapterResult = asRecord(attempt.adapterResult);
  const ebayError = asRecord(adapterResult?.ebayError);
  const failedStep =
    typeof adapterResult?.step === "string" ? friendlyEbayStep(adapterResult.step) : null;
  const ebayErrorStatus =
    typeof ebayError?.status === "number" ? ebayError.status : null;
  const ebayErrorMessage =
    typeof ebayError?.message === "string" ? safeRenderFailure(ebayError.message) : null;
  const bulkRunId =
    typeof adapterResult?.bulkRunId === "string" ? adapterResult.bulkRunId : null;
  return {
    id: attempt.id,
    itemId: item.id,
    itemTitle: draft?.title || item.productName,
    marketplace: mp,
    marketplaceName: marketplaceName(mp),
    environment: listing.environment,
    status: designStatusFromAttempt(attempt.status, {
      code: attempt.code,
      listingStatus: listing.status,
      externalOfferId: listing.externalOfferId,
      externalListingId: listing.externalListingId,
    }),
    rawStatus: attempt.status,
    listingStatus: listing.status,
    time: (attempt.startedAt ?? attempt.createdAt).toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.completedAt?.toISOString() ?? null,
    durationMs:
      attempt.completedAt && attempt.startedAt
        ? attempt.completedAt.getTime() - attempt.startedAt.getTime()
        : null,
    reason: safeRenderFailure(attempt.reason),
    code: attempt.code,
    sku: listing.sku,
    externalOfferId: listing.externalOfferId,
    externalListingId: listing.externalListingId,
    listingLastError: safeRenderFailure(listing.lastError),
    failedStep,
    ebayErrorStatus,
    ebayErrorMessage,
    bulkRunId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function friendlyEbayStep(step: string): string {
  if (step === "inventory_item") return "Create or update inventory item";
  if (step === "offer") return "Create offer";
  if (step === "publish") return "Publish offer";
  return step;
}

export function publishImplementedFor(marketplace: string): boolean {
  return publishImplementedForView(marketplace);
}
