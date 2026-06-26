import { FEATURE_ACCESS_COPY } from "@/lib/auth/feature-access";
import { safePersistedFailureReason } from "@/lib/errors";

import { getEbayEnvironment } from "./adapters/ebay/config";
import { EbayIntegrationError } from "./adapters/ebay/errors";
import {
  loadBulkPublishConfig,
  processInChunks,
  uniqueItemIds,
  type BulkPublishConfig,
} from "./bulk-publish-request";
import { executeEbayDelist, type DelistPrismaLike } from "./delist-handler";

// Bulk eBay end/delist, built entirely on the canonical single-item delist
// service. Preflight is a read-only classification of each selected item;
// execution routes every eligible item through executeEbayDelist so ownership,
// the explicit live confirmation, the DELISTED/in-flight guards, idempotency,
// and sanitized failure recording are all re-checked per item. No local delete
// ever happens here — only the external eBay listing is ended.

export type DelistPreflightStatus =
  | "eligible"
  | "not_listed"
  | "already_ended"
  | "in_flight"
  | "rejected";

export type BulkDelistPreflightItem = { itemId: string; status: DelistPreflightStatus };

export type BulkDelistPreflightResult = {
  liveDelistAllowed: boolean;
  alphaCopy?: string;
  total: number;
  eligibleCount: number;
  notListedCount: number;
  alreadyEndedCount: number;
  inFlightCount: number;
  rejectedCount: number;
  items: BulkDelistPreflightItem[];
};

export type BulkDelistItemResult = {
  itemId: string;
  status: "ended" | "skipped" | "failed";
  message: string;
  retrySafe?: boolean;
};

export type BulkDelistExecutionResult = {
  bulkRunId: string;
  total: number;
  endedCount: number;
  skippedCount: number;
  failedCount: number;
  items: BulkDelistItemResult[];
};

export type BulkDelistDeps = {
  config: BulkPublishConfig;
  preflightItem(input: {
    userId: string;
    accountId?: string;
    itemId: string;
  }): Promise<{ status: DelistPreflightStatus }>;
  executeItem(input: {
    userId: string;
    accountId?: string;
    itemId: string;
    bulkRunId: string;
  }): Promise<BulkDelistItemResult>;
};

export type BulkDelistPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  marketplaceListing: {
    findFirst(args: {
      where: { inventoryItemId: string; marketplace: "ebay"; environment: string };
      select: {
        status: true;
        externalOfferId: true;
        externalListingId: true;
        publishAttempts: {
          select: { status: true; code: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      status: string;
      externalOfferId: string | null;
      externalListingId: string | null;
      publishAttempts: Array<{ status: string; code: string }>;
    } | null>;
  };
};

export function defaultBulkDelistDeps(
  prisma: BulkDelistPrismaLike,
  env: Record<string, string | undefined> = process.env,
): BulkDelistDeps {
  const config = loadBulkPublishConfig(env);
  const environment = getEbayEnvironment(env);

  return {
    config,
    async preflightItem({ userId, accountId, itemId }) {
      const owned = await prisma.inventoryItem.findFirst({
        where: accountId ? { id: itemId, accountId } : { id: itemId, sellerId: userId },
        select: { id: true },
      });
      if (!owned) return { status: "rejected" };

      const listing = await prisma.marketplaceListing.findFirst({
        where: { inventoryItemId: itemId, marketplace: "ebay", environment },
        select: {
          status: true,
          externalOfferId: true,
          externalListingId: true,
          publishAttempts: {
            select: { status: true, code: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });
      if (!listing) return { status: "not_listed" };
      if (listing.status === "DELISTED") return { status: "already_ended" };

      const inFlight = listing.publishAttempts.some(
        (attempt) =>
          attempt.code.startsWith("EBAY_DELIST") &&
          ["QUEUED", "RUNNING"].includes(attempt.status),
      );
      if (inFlight) return { status: "in_flight" };

      if (
        listing.status === "LISTED" &&
        listing.externalOfferId &&
        listing.externalListingId
      ) {
        return { status: "eligible" };
      }
      return { status: "not_listed" };
    },
    async executeItem({ userId, accountId, itemId }) {
      try {
        await executeEbayDelist(prisma as unknown as DelistPrismaLike, {
          userId,
          accountId,
          inventoryItemId: itemId,
          confirmLiveDelist: true,
        });
        return { itemId, status: "ended", message: "Ended on eBay." };
      } catch (error) {
        // A 409 precondition (already ended, not live, or a delist already
        // running) is safe to skip — the listing isn't left in a bad state.
        if (error instanceof EbayIntegrationError && error.status === 409) {
          return {
            itemId,
            status: "skipped",
            message: safePersistedFailureReason(
              error,
              "This listing is already ended or not live on eBay.",
            ),
          };
        }
        // Any other failure: a safe, specific reason (author messages pass
        // through scrubbed; raw provider/DB errors collapse to a fallback).
        return {
          itemId,
          status: "failed",
          message: safePersistedFailureReason(
            error,
            "eBay couldn't end this listing.",
          ),
          retrySafe: true,
        };
      }
    },
  };
}

export async function preflightBulkEbayDelist(
  prisma: BulkDelistPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[]; liveDelistAllowed: boolean },
  deps: BulkDelistDeps = defaultBulkDelistDeps(prisma),
): Promise<BulkDelistPreflightResult> {
  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    const { status } = await deps.preflightItem({ userId: input.userId, accountId: input.accountId, itemId });
    return { itemId, status };
  });
  const count = (status: DelistPreflightStatus) =>
    items.filter((item) => item.status === status).length;

  return {
    liveDelistAllowed: input.liveDelistAllowed,
    alphaCopy: input.liveDelistAllowed ? undefined : FEATURE_ACCESS_COPY.ebayDelist,
    total: items.length,
    eligibleCount: count("eligible"),
    notListedCount: count("not_listed"),
    alreadyEndedCount: count("already_ended"),
    inFlightCount: count("in_flight"),
    rejectedCount: count("rejected"),
    items,
  };
}

export async function executeBulkEbayDelist(
  prisma: BulkDelistPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[]; bulkRunId: string },
  deps: BulkDelistDeps = defaultBulkDelistDeps(prisma),
): Promise<BulkDelistExecutionResult> {
  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    try {
      return await deps.executeItem({ userId: input.userId, accountId: input.accountId, itemId, bulkRunId: input.bulkRunId });
    } catch {
      return {
        itemId,
        status: "failed" as const,
        message: "Something went wrong ending this listing. You can try it again.",
        retrySafe: true,
      };
    }
  });
  const count = (status: BulkDelistItemResult["status"]) =>
    items.filter((item) => item.status === status).length;

  return {
    bulkRunId: input.bulkRunId,
    total: items.length,
    endedCount: count("ended"),
    skippedCount: count("skipped"),
    failedCount: count("failed"),
    items,
  };
}
