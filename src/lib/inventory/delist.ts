import type {
  Marketplace,
  MarketplaceListingStatus,
  Prisma,
} from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

import { recordInventoryEvent, type InventoryEventPrismaLike } from "./events";
import { createReviewTask, type ReviewTaskPrismaLike } from "./review-tasks";
import { enqueueSyncJob, type SyncJobPrismaLike } from "./sync-jobs";
import { marketplaceLabel } from "./notifications";

// Queues delist work for every OTHER live listing of a sold item, idempotently.
// The sold-source marketplace is never touched. eBay and StockX have real
// delist adapters, so those jobs are queued for a worker to execute; everything
// else is parked as needs_review AND a manual_delist_required ReviewTask is
// created with the listing URL + clear instructions. NO live marketplace/network
// call happens here — this layer only records intent. Calling twice produces no
// duplicate jobs or tasks.

// Marketplaces with a real delist adapter that a worker can execute autonomously.
const MARKETPLACES_WITH_DELIST_ADAPTER: ReadonlySet<Marketplace> = new Set<Marketplace>([
  "ebay",
  "stockx",
]);

export function hasDelistAdapter(marketplace: Marketplace): boolean {
  return MARKETPLACES_WITH_DELIST_ADAPTER.has(marketplace);
}

// Listing statuses still considered "live enough" to be worth delisting. A
// listing already SOLD/DELISTED/ENDED/FAILED/NOT_LISTED needs no action.
const DELISTABLE_STATUSES: ReadonlySet<MarketplaceListingStatus> =
  new Set<MarketplaceListingStatus>([
    "LISTED",
    "LISTING",
    "QUEUED",
    "UNKNOWN",
    "NEEDS_REVIEW",
  ]);

export type DelistListingRow = {
  id: string;
  marketplace: Marketplace;
  status: MarketplaceListingStatus;
  externalUrl: string | null;
};

export type DelistPrismaLike = SyncJobPrismaLike &
  ReviewTaskPrismaLike &
  InventoryEventPrismaLike & {
    marketplaceListing: {
      findMany(args: {
        where: { inventoryItemId: string };
        select: {
          id: true;
          marketplace: true;
          status: true;
          externalUrl: true;
        };
      }): Promise<DelistListingRow[]>;
    };
    inventoryItem: {
      findFirst(args: {
        where: { id: string; sellerId: string };
        select: { id: true; productName: true };
      }): Promise<{ id: string; productName: string } | null>;
    };
  };

export type QueueDelistResult = {
  // ONLY auto-executable (adapter-available) delist jobs. A non-adapter
  // listing has no delist adapter; its job is parked as needs_review and tracked
  // in manualReviewTaskIds instead — never counted as an automatic removal.
  queuedJobIds: string[];
  manualReviewTaskIds: string[];
  skippedSoldSource: boolean;
};

export function delistIdempotencyKey(
  inventoryItemId: string,
  marketplaceListingId: string,
): string {
  return `delist:${inventoryItemId}:${marketplaceListingId}`;
}

export async function queueDelistOtherListings(
  db: DelistPrismaLike = getPrisma(),
  inventoryItemId: string,
  // null = "source unknown" (e.g. a manual mark-sold with no named marketplace):
  // skip NO listing, queue a delist for EVERY active listing.
  soldMarketplace: Marketplace | null,
  userId: string,
  inventoryOwnerUserId: string = userId,
): Promise<QueueDelistResult> {
  // Ownership: only the owning seller's item is ever inspected/acted on.
  const item = await db.inventoryItem.findFirst({
    where: { id: inventoryItemId, sellerId: inventoryOwnerUserId },
    select: { id: true, productName: true },
  });
  if (!item) {
    // Defense-in-depth: callers already scope, but never act on a foreign item.
    return { queuedJobIds: [], manualReviewTaskIds: [], skippedSoldSource: false };
  }

  const listings = await db.marketplaceListing.findMany({
    where: { inventoryItemId },
    select: { id: true, marketplace: true, status: true, externalUrl: true },
  });

  const result: QueueDelistResult = {
    queuedJobIds: [],
    manualReviewTaskIds: [],
    skippedSoldSource: false,
  };

  for (const listing of listings) {
    // Never delist the marketplace the sale came from. With an unknown source
    // (null) there is nothing to skip — every active listing is delisted.
    if (soldMarketplace !== null && listing.marketplace === soldMarketplace) {
      result.skippedSoldSource = true;
      continue;
    }
    if (!DELISTABLE_STATUSES.has(listing.status)) {
      continue;
    }

    const idempotencyKey = delistIdempotencyKey(inventoryItemId, listing.id);
    const adapterAvailable = hasDelistAdapter(listing.marketplace);

    const job = await enqueueSyncJob(db, {
      userId,
      type: "delist_marketplace_listing",
      idempotencyKey,
      inventoryItemId,
      marketplaceListingId: listing.id,
      // Adapter-backed marketplaces are executed by a worker; everything else
      // parks for manual action.
      status: adapterAvailable ? "queued" : "needs_review",
      payload: {
        inventoryItemId,
        marketplaceListingId: listing.id,
        marketplace: listing.marketplace,
        soldMarketplace,
        useAdapter: adapterAvailable,
        externalUrl: listing.externalUrl,
      } as Prisma.InputJsonValue,
    });
    // Only adapter-available (eBay) jobs are auto-executable, so only those count
    // as a queued automatic delist. A non-eBay job is parked needs_review and
    // tracked via manualReviewTaskIds below — never a fake "we're removing it".
    if (adapterAvailable) {
      result.queuedJobIds.push(job.id);
    }

    if (!adapterAvailable) {
      const label = marketplaceLabel(listing.marketplace);
      const where = listing.externalUrl ? ` (${listing.externalUrl})` : "";
      const soldWhere = soldMarketplace
        ? `sold on ${marketplaceLabel(soldMarketplace)}`
        : "sold";
      const task = await createReviewTask(db, {
        userId,
        type: "manual_delist_required",
        inventoryItemId,
        marketplace: listing.marketplace,
        title: `Remove "${item.productName}" from ${label}`,
        description:
          `Your "${item.productName}" ${soldWhere}. ` +
          `We can't remove the ${label} listing for you automatically. Please open your ` +
          `${label} listing${where} and end it now so the item can't sell twice.`,
        payload: {
          inventoryItemId,
          marketplaceListingId: listing.id,
          marketplace: listing.marketplace,
          soldMarketplace,
          externalUrl: listing.externalUrl,
          syncJobId: job.id,
        } as Prisma.InputJsonValue,
      });
      result.manualReviewTaskIds.push(task.id);
    }

    await recordInventoryEvent(db, {
      inventoryItemId,
      userId,
      type: "delist_requested",
      source: "system",
      marketplace: listing.marketplace,
      payload: {
        marketplaceListingId: listing.id,
        soldMarketplace,
        syncJobId: job.id,
        useAdapter: adapterAvailable,
      } as Prisma.InputJsonValue,
    });
  }

  return result;
}
