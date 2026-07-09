import type { ItemCondition } from "@/generated/prisma/client";
import { AppError, safePersistedFailureReason } from "@/lib/errors";
import { FEATURE_ACCESS_COPY } from "@/lib/auth/feature-access";

import { getEbayEnvironment } from "./adapters/ebay/config";
import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { preflightEbayListing } from "./adapters/ebay/preflight";
import {
  isStockXApiConfigured,
  isStockXListingEnabled,
} from "./adapters/stockx/config";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";
import { evaluateStockXListingReadiness } from "./adapters/stockx/readiness";
import { STOCKX_ENVIRONMENT } from "./adapters/stockx/types";
import {
  loadBulkPublishConfig,
  processInChunks,
  uniqueItemIds,
  type BulkPublishConfig,
} from "./bulk-publish-request";
import { executePublish, type PublishPrismaLike } from "./publish-handler";

// Bulk eBay publishing built ENTIRELY on the canonical single-item services:
// preflight reuses the eBay dry-run; execution calls executePublish per item so
// ownership, ready state, eBay readiness, the global gate, and DB duplicate
// protection are all re-checked. Nothing here is a low product cap — every
// selected eligible item is processed, in bounded chunks with low concurrency.

export type ItemPreflightStatus = "ready" | "needs_details" | "skipped" | "rejected";

export type ItemPreflightOutcome = {
  status: ItemPreflightStatus;
  missing?: string[];
};

export type BulkPreflightItem = { itemId: string } & ItemPreflightOutcome;
export type BulkPublishMarketplace = "ebay" | "stockx";

export type BulkPreflightResult = {
  livePublishAllowed: boolean;
  alphaCopy?: string;
  total: number;
  readyCount: number;
  needsDetailsCount: number;
  skippedCount: number;
  rejectedCount: number;
  items: BulkPreflightItem[];
};

export type BulkItemResult = {
  itemId: string;
  status: "published" | "skipped" | "needs_details" | "failed";
  message: string;
  missing?: string[];
  externalListingId?: string | null;
  retrySafe?: boolean;
};

export type BulkExecutionResult = {
  bulkRunId: string;
  total: number;
  publishedCount: number;
  skippedCount: number;
  failedCount: number;
  needsDetailsCount: number;
  items: BulkItemResult[];
};

export type BulkPublishDeps = {
  config: BulkPublishConfig;
  preflightItem(input: { userId: string; accountId?: string; itemId: string }): Promise<ItemPreflightOutcome>;
  executeItem(input: {
    userId: string;
    accountId?: string;
    itemId: string;
    bulkRunId: string;
  }): Promise<BulkItemResult>;
};

export type BulkPublishPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  marketplaceListing: {
    findFirst(args: {
      where: { inventoryItemId: string; marketplace: BulkPublishMarketplace; environment: string };
      select: {
        status: true;
        externalListingId: true;
        publishAttempts?: {
          select: { status: true; code: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      status: string;
      externalListingId: string | null;
      publishAttempts?: Array<{ status: string; code: string }>;
    } | null>;
  };
};

type StockXDraftRow = {
  title: string | null;
  recommendedPriceCents: number | null;
  selectedMarketplaces: string[];
  stockxProductId: string | null;
  stockxVariantId: string | null;
  marketplaceDrafts: unknown;
};

type StockXItemRow = {
  id: string;
  productName: string;
  condition: ItemCondition;
  quantityAvailable: number;
  recommendedPriceCents: number | null;
  listingDrafts: StockXDraftRow[];
};

export type BulkStockXPublishPrismaLike = BulkPublishPrismaLike & {
  inventoryItem: BulkPublishPrismaLike["inventoryItem"] & {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      include?: unknown;
      select?: unknown;
    }): Promise<StockXItemRow | { id: string } | null>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        accountId_marketplace_environment?: {
          accountId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
        userId_marketplace_environment?: {
          userId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
      };
      select?: unknown;
    }): Promise<{ id: string } | null>;
  };
};

const MISSING_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  sale_wording: "Description",
  price: "Price",
  photo: "Photos",
  ebay_public_photo: "Photos",
  condition: "Condition",
  categoryId: "Category",
  ebay_category: "Category",
  ebay_size: "Size",
  ebay_aspects: "Item specifics",
  quantity: "Quantity",
  ebay_connection: "eBay connection",
  seller_config: "eBay account setup",
  paymentPolicyId: "Payment policy",
  fulfillmentPolicyId: "Shipping policy",
  returnPolicyId: "Return policy",
  merchantLocationKey: "Item location",
  item_ownership: "Item",
};

const STOCKX_MISSING_LABELS: Record<string, string> = {
  stockx_api: "StockX API",
  stockx_listing_enabled: "StockX listing access",
  stockx_connection: "StockX seller connection",
  stockx_target: "StockX marketplace selection",
  stockx_product_match: "Exact StockX product",
  stockx_variant_match: "Exact StockX size/variant",
  stockx_size: "StockX size label",
  price: "Price",
  inventory_quantity: "Quantity",
  condition: "Condition",
  duplicate: "Existing StockX listing",
};

function friendlyMissing(code: string): string {
  return (
    MISSING_LABELS[code] ??
    code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function friendlyStockXMissing(code: string): string {
  return STOCKX_MISSING_LABELS[code] ?? friendlyMissing(code);
}

function stockxMissingLabels(codes: string[]): string[] {
  const labels: string[] = [];
  for (const code of codes) {
    const label = friendlyStockXMissing(code);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

// Pulls the missing-field codes off a readiness EbayIntegrationError and maps
// them to seller-facing labels, de-duped (several codes can map to one label).
function readinessMissingLabels(error: EbayIntegrationError): string[] {
  const raw = error.details?.missing;
  if (!Array.isArray(raw)) return [];
  const labels: string[] = [];
  for (const code of raw) {
    if (typeof code !== "string") continue;
    const label = friendlyMissing(code);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

const LIVE_LISTING_STATUSES = new Set(["LISTED", "PUBLISHING", "DELISTING"]);
const STOCKX_DUPLICATE_STATUSES = new Set(["LISTED", "LISTING", "DELISTING"]);
const STOCKX_DELISTED_STATUSES = new Set(["DELISTED", "ENDED"]);

export function defaultBulkPublishDeps(
  prisma: BulkPublishPrismaLike,
  env: Record<string, string | undefined> = process.env,
): BulkPublishDeps {
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
        select: { status: true, externalListingId: true },
      });
      if (listing && (listing.externalListingId || LIVE_LISTING_STATUSES.has(listing.status))) {
        return { status: "skipped" };
      }

      const pre = await preflightEbayListing(
        prisma as never,
        { userId, accountId, inventoryItemId: itemId },
        env,
      );
      if (pre.ready) return { status: "ready" };
      return { status: "needs_details", missing: pre.missing.map(friendlyMissing) };
    },
    async executeItem({ userId, accountId, itemId, bulkRunId }) {
      try {
        const r = await executePublish(prisma as unknown as PublishPrismaLike, {
          userId,
          accountId,
          inventoryItemId: itemId,
          marketplace: "ebay",
          bulkRunId,
        });
        const outcome = r.outcome as { status?: string };
        if (outcome.status === "published") {
          return {
            itemId,
            status: "published",
            message: "Listed on eBay.",
            externalListingId: r.listingId ?? null,
          };
        }
        return {
          itemId,
          status: "skipped",
          message: "eBay publishing isn't enabled yet.",
          retrySafe: true,
        };
      } catch (error) {
        if (error instanceof EbayIntegrationError && error.code === ebayErrorCodes.alreadyPublished) {
          return { itemId, status: "skipped", message: "This item is already listed on eBay." };
        }
        if (error instanceof EbayIntegrationError && error.code === ebayErrorCodes.readinessFailed) {
          // Surface the exact missing fields so a retry isn't a guessing game.
          const missing = readinessMissingLabels(error);
          return {
            itemId,
            status: "needs_details",
            message:
              missing.length > 0
                ? `Needs ${missing.join(", ")} before it can go live.`
                : "This listing needs a few more details before it can go live.",
            missing,
          };
        }
        // Any other failure: a safe, specific reason (author-written messages
        // pass through scrubbed; raw provider/DB errors collapse to a generic
        // fallback — never a leak). Retry stays safe: a failed attempt never
        // poisons the item, so the seller can try again.
        return {
          itemId,
          status: "failed",
          message: safePersistedFailureReason(
            error,
            "Something went wrong publishing this item.",
          ),
          retrySafe: true,
        };
      }
    },
  };
}

export function defaultBulkStockXPublishDeps(
  prisma: BulkStockXPublishPrismaLike,
  env: Record<string, string | undefined> = process.env,
): BulkPublishDeps {
  const config = loadBulkPublishConfig(env);
  const apiConfigured = isStockXApiConfigured(env);
  const listingEnabled = isStockXListingEnabled(env);

  return {
    config,
    async preflightItem({ userId, accountId, itemId }) {
      const item = await prisma.inventoryItem.findFirst({
        where: accountId ? { id: itemId, accountId } : { id: itemId, sellerId: userId },
        include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
      });
      if (!isStockXItemRow(item)) return { status: "rejected", missing: ["Item"] };

      const connection = await prisma.marketplaceConnection.findUnique({
        where: accountId
          ? {
              accountId_marketplace_environment: {
                accountId,
                marketplace: "stockx",
                environment: STOCKX_ENVIRONMENT,
              },
            }
          : {
              userId_marketplace_environment: {
                userId,
                marketplace: "stockx",
                environment: STOCKX_ENVIRONMENT,
              },
            },
        select: { id: true },
      });

      const listing = await prisma.marketplaceListing.findFirst({
        where: { inventoryItemId: itemId, marketplace: "stockx", environment: STOCKX_ENVIRONMENT },
        select: {
          status: true,
          externalListingId: true,
          publishAttempts: {
            select: { status: true, code: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });
      if (isDuplicateStockXPublish(listing)) {
        return { status: "skipped", missing: ["Existing StockX listing"] };
      }

      const draft = item.listingDrafts[0] ?? null;
      const stockxDraft = stockxDraftOf(draft?.marketplaceDrafts);
      const productId = draft?.stockxProductId ?? stringOf(stockxDraft.productId);
      const variantId = draft?.stockxVariantId ?? stringOf(stockxDraft.variantId);
      const size = stringOf(stockxDraft.size);
      const priceCents =
        draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null;
      const readiness = evaluateStockXListingReadiness({
        apiConfigured,
        listingEnabled,
        connected: Boolean(connection),
        productId,
        variantId,
        priceCents,
        quantityAvailable: item.quantityAvailable,
        confirmed: true,
      });
      const missing = [...readiness.missing];
      if (!draft?.selectedMarketplaces.includes("stockx")) missing.push("stockx_target");
      if (!size) missing.push("stockx_size");
      if (item.condition === "unknown") missing.push("condition");

      if (missing.length > 0) {
        return { status: "needs_details", missing: stockxMissingLabels(missing) };
      }

      return { status: "ready" };
    },
    async executeItem({ userId, accountId, itemId, bulkRunId }) {
      try {
        const r = await executePublish(prisma as unknown as PublishPrismaLike, {
          userId,
          accountId,
          inventoryItemId: itemId,
          marketplace: "stockx",
          bulkRunId,
          confirmLivePublish: true,
        });
        const outcome = r.outcome as { status?: string; message?: string };
        if (outcome.status === "published" || outcome.status === "submitted") {
          return {
            itemId,
            status: "published",
            message:
              outcome.status === "published"
                ? "Listed on StockX."
                : "Submitted to StockX. Sello is checking status.",
            externalListingId: r.listingId ?? null,
          };
        }
        return {
          itemId,
          status: "skipped",
          message: outcome.message ?? "StockX listing creation is not enabled.",
          retrySafe: true,
        };
      } catch (error) {
        if (
          error instanceof StockXIntegrationError &&
          error.code === stockxErrorCodes.alreadyPublished
        ) {
          return {
            itemId,
            status: "skipped",
            message: "This item already has a StockX listing or listing operation.",
          };
        }
        if (
          error instanceof StockXIntegrationError &&
          error.code === stockxErrorCodes.listingReadinessFailed
        ) {
          const raw = Array.isArray(error.details?.missing)
            ? error.details.missing.filter((id): id is string => typeof id === "string")
            : [];
          const missing = stockxMissingLabels(raw);
          return {
            itemId,
            status: "needs_details",
            message:
              missing.length > 0
                ? `Needs ${missing.join(", ")} before it can go live on StockX.`
                : "This listing needs an exact StockX product and size before it can go live.",
            missing,
          };
        }
        return {
          itemId,
          status: "failed",
          message: safePersistedFailureReason(
            error,
            "StockX could not create this listing.",
          ),
          retrySafe: true,
        };
      }
    },
  };
}

export async function preflightBulkEbayPublish(
  prisma: BulkPublishPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[]; livePublishAllowed: boolean },
  deps: BulkPublishDeps = defaultBulkPublishDeps(prisma),
): Promise<BulkPreflightResult> {
  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    const outcome = await deps.preflightItem({ userId: input.userId, accountId: input.accountId, itemId });
    return { itemId, ...outcome };
  });
  const count = (status: ItemPreflightStatus) =>
    items.filter((item) => item.status === status).length;

  return {
    livePublishAllowed: input.livePublishAllowed,
    alphaCopy: input.livePublishAllowed ? undefined : FEATURE_ACCESS_COPY.liveEbayPublish,
    total: items.length,
    readyCount: count("ready"),
    needsDetailsCount: count("needs_details"),
    skippedCount: count("skipped"),
    rejectedCount: count("rejected"),
    items,
  };
}

export async function executeBulkEbayPublish(
  prisma: BulkPublishPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[]; bulkRunId: string },
  deps: BulkPublishDeps = defaultBulkPublishDeps(prisma),
): Promise<BulkExecutionResult> {
  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    try {
      return await deps.executeItem({ userId: input.userId, accountId: input.accountId, itemId, bulkRunId: input.bulkRunId });
    } catch {
      return {
        itemId,
        status: "failed" as const,
        message: "Something went wrong publishing this item. You can try it again.",
        retrySafe: true,
      };
    }
  });
  const count = (status: BulkItemResult["status"]) =>
    items.filter((item) => item.status === status).length;

  return {
    bulkRunId: input.bulkRunId,
    total: items.length,
    publishedCount: count("published"),
    skippedCount: count("skipped"),
    failedCount: count("failed"),
    needsDetailsCount: count("needs_details"),
    items,
  };
}

export async function preflightBulkStockXPublish(
  prisma: BulkStockXPublishPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[] },
  deps: BulkPublishDeps = defaultBulkStockXPublishDeps(prisma),
): Promise<BulkPreflightResult> {
  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    const outcome = await deps.preflightItem({
      userId: input.userId,
      accountId: input.accountId,
      itemId,
    });
    return { itemId, ...outcome };
  });
  const count = (status: ItemPreflightStatus) =>
    items.filter((item) => item.status === status).length;

  return {
    livePublishAllowed: true,
    total: items.length,
    readyCount: count("ready"),
    needsDetailsCount: count("needs_details"),
    skippedCount: count("skipped"),
    rejectedCount: count("rejected"),
    items,
  };
}

export async function executeBulkStockXPublish(
  prisma: BulkStockXPublishPrismaLike,
  input: { userId: string; accountId?: string; itemIds: string[]; bulkRunId: string },
  deps: BulkPublishDeps = defaultBulkStockXPublishDeps(prisma),
): Promise<BulkExecutionResult> {
  const preflight = await preflightBulkStockXPublish(prisma, input, deps);
  if (preflight.readyCount !== preflight.total) {
    throw new AppError(
      "Fix blocked StockX listings before creating a live StockX bulk publish batch.",
      400,
      "BULK_STOCKX_PREFLIGHT_BLOCKED",
    );
  }

  const itemIds = uniqueItemIds(input.itemIds);
  const items = await processInChunks(itemIds, deps.config, async (itemId) => {
    try {
      return await deps.executeItem({
        userId: input.userId,
        accountId: input.accountId,
        itemId,
        bulkRunId: input.bulkRunId,
      });
    } catch {
      return {
        itemId,
        status: "failed" as const,
        message: "Something went wrong publishing this StockX listing. You can try it again.",
        retrySafe: true,
      };
    }
  });
  const count = (status: BulkItemResult["status"]) =>
    items.filter((item) => item.status === status).length;

  return {
    bulkRunId: input.bulkRunId,
    total: items.length,
    publishedCount: count("published"),
    skippedCount: count("skipped"),
    failedCount: count("failed"),
    needsDetailsCount: count("needs_details"),
    items,
  };
}

function isDuplicateStockXPublish(
  listing:
    | {
        status: string;
        externalListingId: string | null;
        publishAttempts?: Array<{ status: string; code?: string }>;
      }
    | null,
): boolean {
  if (!listing) return false;
  if (listing.externalListingId || STOCKX_DUPLICATE_STATUSES.has(listing.status)) {
    return true;
  }
  if (STOCKX_DELISTED_STATUSES.has(listing.status)) return false;
  return Boolean(
    listing.publishAttempts?.some(
      (attempt) =>
        typeof attempt.code === "string" &&
        attempt.code.startsWith("STOCKX_LISTING") &&
        ["QUEUED", "RUNNING", "SUCCEEDED"].includes(attempt.status),
    ),
  );
}

function isStockXItemRow(value: unknown): value is StockXItemRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StockXItemRow>;
  return typeof row.id === "string" && Array.isArray(row.listingDrafts);
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
