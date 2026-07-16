import type {
  Marketplace,
  Prisma,
} from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

import { recordInventoryEvent, type InventoryEventPrismaLike } from "./events";
import {
  markItemSold,
  type MarkItemSoldResult,
  type MarkSoldPrismaLike,
} from "./mark-sold";
import {
  createNotification,
  possibleSaleConfirmCopy,
  type NotificationPrismaLike,
} from "./notifications";
import { createReviewTask, type ReviewTaskPrismaLike } from "./review-tasks";

// Entry point for an inbound sale signal (marketplace API poll, parsed email,
// etc.). It matches the signal to one of the seller's listings, records a
// sale_detected event, then routes by confidence:
//   high  + strong match -> markItemSold (queues delist + notifies)
//   medium               -> confirm_possible_sale ReviewTask + notification; NO delist
//   low / unmatched      -> ReviewTask only (confirm_possible_sale if matched,
//                           else unmatched_marketplace_email); NO delist
// Never auto-delists on anything below high confidence — that is the core rule.

export const CONFIDENCE_THRESHOLDS = { high: 0.85, medium: 0.5 } as const;

export type ConfidenceBand = "high" | "medium" | "low";

export function classifyConfidence(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

export type SaleSignalListingRow = {
  id: string;
  inventoryItemId: string;
  marketplace: Marketplace;
  externalListingId: string | null;
  externalUrl: string | null;
  titleSnapshot: string | null;
};

// Surface for matching a sale signal to one of the seller's listings. Kept
// separate from MarkSoldPrismaLike's marketplaceListing methods (different
// where/select shapes) so the two never collide into an unassignable overload.
type SaleSignalListingDelegate = {
  findFirst(args: {
    where: {
      marketplace: Marketplace;
      inventoryItem: { accountId: string };
      externalListingId?: string;
      externalUrl?: string;
    };
    select: typeof listingSelect;
  }): Promise<SaleSignalListingRow | null>;
  findMany(args: {
    where: {
      marketplace: Marketplace;
      inventoryItem: { accountId: string };
    };
    select: typeof listingSelect;
  }): Promise<SaleSignalListingRow[]>;
};

export type SaleSignalPrismaLike = Omit<MarkSoldPrismaLike, "marketplaceListing"> &
  ReviewTaskPrismaLike &
  NotificationPrismaLike &
  InventoryEventPrismaLike & {
    marketplaceListing: MarkSoldPrismaLike["marketplaceListing"] &
      SaleSignalListingDelegate;
  };

export type HandleSaleSignalInput = {
  userId: string;
  accountId: string;
  marketplace: Marketplace;
  source: "api" | "email" | "manual" | "system";
  externalListingId?: string | null;
  externalUrl?: string | null;
  title?: string | null;
  price?: number | null;
  occurredAt?: Date | null;
  // Caller-provided confidence (0..1). Bands derive from CONFIDENCE_THRESHOLDS.
  confidence: number;
  rawPayload?: Prisma.InputJsonValue;
};

export type SaleSignalMatch = {
  listing: SaleSignalListingRow;
  // "exact" = matched on externalListingId/externalUrl; "fuzzy" = title only.
  matchType: "exact" | "fuzzy";
};

export type HandleSaleSignalResult =
  | { outcome: "marked_sold"; match: SaleSignalMatch; markSold: MarkItemSoldResult }
  | { outcome: "review_possible_sale"; match: SaleSignalMatch; reviewTaskId: string }
  | { outcome: "review_unmatched"; reviewTaskId: string };

// Lightweight, deterministic title similarity (no live calls). Tokenizes,
// lowercases, and returns the Jaccard overlap of the word sets.
export function titleSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

const FUZZY_TITLE_THRESHOLD = 0.6;

async function matchListing(
  db: SaleSignalPrismaLike,
  input: HandleSaleSignalInput,
): Promise<SaleSignalMatch | null> {
  const ownerScope = { accountId: input.accountId };

  if (input.externalListingId) {
    const byId = await db.marketplaceListing.findFirst({
      where: {
        marketplace: input.marketplace,
        inventoryItem: ownerScope,
        externalListingId: input.externalListingId,
      },
      select: listingSelect,
    });
    if (byId) return { listing: byId, matchType: "exact" };
  }

  if (input.externalUrl) {
    const byUrl = await db.marketplaceListing.findFirst({
      where: {
        marketplace: input.marketplace,
        inventoryItem: ownerScope,
        externalUrl: input.externalUrl,
      },
      select: listingSelect,
    });
    if (byUrl) return { listing: byUrl, matchType: "exact" };
  }

  if (input.title) {
    const candidates = await db.marketplaceListing.findMany({
      where: { marketplace: input.marketplace, inventoryItem: ownerScope },
      select: listingSelect,
    });
    let best: { listing: SaleSignalListingRow; score: number } | null = null;
    for (const candidate of candidates) {
      if (!candidate.titleSnapshot) continue;
      const score = titleSimilarity(input.title, candidate.titleSnapshot);
      if (score >= FUZZY_TITLE_THRESHOLD && (!best || score > best.score)) {
        best = { listing: candidate, score };
      }
    }
    if (best) return { listing: best.listing, matchType: "fuzzy" };
  }

  return null;
}

const listingSelect = {
  id: true,
  inventoryItemId: true,
  marketplace: true,
  externalListingId: true,
  externalUrl: true,
  titleSnapshot: true,
} as const;

export async function handleSaleSignal(
  db: SaleSignalPrismaLike = getPrisma(),
  input: HandleSaleSignalInput,
): Promise<HandleSaleSignalResult> {
  const band = classifyConfidence(input.confidence);
  const match = await matchListing(db, input);

  if (match) {
    await recordInventoryEvent(db, {
      inventoryItemId: match.listing.inventoryItemId,
      userId: input.userId,
      accountId: input.accountId,
      type: "sale_detected",
      source: input.source,
      marketplace: input.marketplace,
      confidence: input.confidence,
      payload: {
        marketplaceListingId: match.listing.id,
        matchType: match.matchType,
        externalListingId: input.externalListingId ?? null,
        externalUrl: input.externalUrl ?? null,
        price: input.price ?? null,
        occurredAt: input.occurredAt?.toISOString() ?? null,
        confidenceBand: band,
        rawPayload: input.rawPayload ?? null,
      } as Prisma.InputJsonValue,
    });
  }

  // High confidence + a strong (exact) match: act autonomously.
  if (band === "high" && match && match.matchType === "exact") {
    const markSold = await markItemSold(db, {
      inventoryItemId: match.listing.inventoryItemId,
      userId: input.userId,
      accountId: input.accountId,
      soldMarketplace: input.marketplace,
      soldListingId: match.listing.externalListingId,
      soldPriceCents: input.price ?? null,
      source: input.source,
    });
    return { outcome: "marked_sold", match, markSold };
  }

  // Matched but not confident enough to auto-act: ask the seller to confirm. A
  // high-confidence-but-fuzzy match also lands here — never auto-delist on fuzzy.
  if (match) {
    const productName = match.listing.titleSnapshot ?? "your item";
    const task = await createReviewTask(db, {
      userId: input.userId,
      accountId: input.accountId,
      type: "confirm_possible_sale",
      inventoryItemId: match.listing.inventoryItemId,
      marketplace: input.marketplace,
      title: `Did "${productName}" sell on ${input.marketplace}?`,
      description:
        `We saw a possible sale of "${productName}" on ${input.marketplace} but aren't ` +
        `confident enough to remove your other listings automatically. Confirm it so we ` +
        `can take it down everywhere else.`,
      payload: {
        marketplaceListingId: match.listing.id,
        matchType: match.matchType,
        confidence: input.confidence,
        confidenceBand: band,
        externalListingId: input.externalListingId ?? null,
        externalUrl: input.externalUrl ?? null,
        price: input.price ?? null,
        source: input.source,
      } as Prisma.InputJsonValue,
    });

    await createNotification(db, {
      userId: input.userId,
      accountId: input.accountId,
      inventoryItemId: match.listing.inventoryItemId,
      ...possibleSaleConfirmCopy({ productName, marketplace: input.marketplace }),
    });

    return { outcome: "review_possible_sale", match, reviewTaskId: task.id };
  }

  // No match at all: park an unmatched-email review task. No item to attach to.
  const task = await createReviewTask(db, {
    userId: input.userId,
    accountId: input.accountId,
    type: "unmatched_marketplace_email",
    inventoryItemId: null,
    marketplace: input.marketplace,
    title: `Possible ${input.marketplace} sale we couldn't match`,
    description:
      `We saw a possible sale signal from ${input.marketplace} but couldn't match it to ` +
      `one of your listings. Review it and mark the right item sold if needed.`,
    payload: {
      marketplace: input.marketplace,
      confidence: input.confidence,
      confidenceBand: band,
      externalListingId: input.externalListingId ?? null,
      externalUrl: input.externalUrl ?? null,
      title: input.title ?? null,
      price: input.price ?? null,
      source: input.source,
      rawPayload: input.rawPayload ?? null,
    } as Prisma.InputJsonValue,
  });

  return { outcome: "review_unmatched", reviewTaskId: task.id };
}
