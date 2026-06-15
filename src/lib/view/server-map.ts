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
import { describeState, toLifecycleState } from "@/lib/lifecycle/item-status";
import {
  getEbayEnvironment,
  isEbayProductionPublishEnabled,
} from "@/lib/marketplace/adapters/ebay/config";
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

function publishImplementedForView(marketplace: string): boolean {
  if (marketplace === "ebay") {
    if (getEbayEnvironment() === "production") {
      return isEbayProductionPublishEnabled();
    }
    return ADAPTER_PUBLISH.get(marketplace) ?? false;
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
      publishImplemented: publishImplementedForView(mp),
      environment: listing?.environment ?? null,
      sku: listing?.sku ?? null,
      externalOfferId: listing?.externalOfferId ?? null,
      externalListingId: listing?.externalListingId ?? null,
      lastError: listing?.lastError ?? null,
    };
  });
}

export function mapItem(item: ItemWithRelations): ItemView {
  const draft = latestDraft(item);
  const lifecycleState = toLifecycleState(item.status);
  return {
    id: item.id,
    title: draft?.title || item.productName,
    productName: item.productName,
    brand: item.brand,
    category: item.category,
    condition: item.condition,
    size: item.size,
    colorway: item.colorway,
    priceCents: draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null,
    status: designStatusFromInventory(item.status),
    lifecycleState,
    statusLabel: describeState(lifecycleState).label,
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
    selectedMarketplaces: (draft?.selectedMarketplaces ?? []) as string[],
    readiness,
    attempts,
    photos,
  };
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
    typeof ebayError?.message === "string" ? ebayError.message : null;
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
    reason: attempt.reason,
    code: attempt.code,
    sku: listing.sku,
    externalOfferId: listing.externalOfferId,
    externalListingId: listing.externalListingId,
    listingLastError: listing.lastError,
    failedStep,
    ebayErrorStatus,
    ebayErrorMessage,
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
