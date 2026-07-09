import type {
  InventoryStatus,
  Marketplace,
  Prisma,
} from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

import {
  queueDelistOtherListings,
  type DelistPrismaLike,
  type QueueDelistResult,
} from "./delist";
import { recordInventoryEvent, type InventoryEventPrismaLike } from "./events";
import {
  createNotification,
  soldDelistingCopy,
  syncConflictCopy,
  type NotificationPrismaLike,
} from "./notifications";
import { createReviewTask, type ReviewTaskPrismaLike } from "./review-tasks";

// Authoritative "this item sold" mutation — the heart of double-sell prevention.
// Loads the item scoped by sellerId (404 if not owned). Idempotent + conflict
// safe:
//   - already sold from the SAME marketplace  -> no-op (returns already_sold)
//   - already sold from a DIFFERENT source    -> create a sync_conflict
//     ReviewTask, DO NOT overwrite the sold source, return conflict
//   - otherwise -> in one transaction set SOLD / quantityAvailable=0 / soldAt /
//     soldSource* / bump lockVersion, record sale_confirmed; then queue delist
//     for every OTHER live listing (idempotent) and notify the seller.
// No live marketplace/network call happens here.

export type MarkSoldItemRow = {
  id: string;
  sellerId: string;
  productName: string;
  status: InventoryStatus;
  soldSourceMarketplace: Marketplace | null;
  soldSourceListingId: string | null;
  lockVersion: number;
};

// The mark-sold transaction does the SOLD flip, the audit event, AND the delist
// queueing atomically, so it needs the full delist surface (DelistPrismaLike)
// plus inventoryItem.update.
export type MarkSoldTransaction = DelistPrismaLike & {
  inventoryItem: DelistPrismaLike["inventoryItem"] & {
    update(args: {
      where: { id: string; lockVersion: number };
      data: {
        status: InventoryStatus;
        quantityAvailable: number;
        soldAt: Date;
        soldSourceMarketplace: Marketplace | null;
        soldSourceListingId: string | null;
        lockVersion: { increment: number };
      };
    }): Promise<{ id: string }>;
  };
};

export type MarkSoldPrismaLike = DelistPrismaLike &
  ReviewTaskPrismaLike &
  NotificationPrismaLike &
  InventoryEventPrismaLike & {
    inventoryItem: DelistPrismaLike["inventoryItem"] & {
      findFirst(args: {
        where: { id: string; sellerId: string };
        select: {
          id: true;
          sellerId: true;
          productName: true;
          status: true;
          soldSourceMarketplace: true;
          soldSourceListingId: true;
          lockVersion: true;
        };
      }): Promise<MarkSoldItemRow | null>;
    };
    $transaction<T>(callback: (tx: MarkSoldTransaction) => Promise<T>): Promise<T>;
  };

export type MarkItemSoldInput = {
  inventoryItemId: string;
  userId: string;
  inventoryOwnerUserId?: string;
  // null = "source unknown" (e.g. a manual mark-sold via the lifecycle route):
  // record no sold source and delist EVERY active listing.
  soldMarketplace: Marketplace | null;
  soldListingId?: string | null;
  soldPriceCents?: number | null;
  source: "api" | "email" | "manual" | "system";
};

export type MarkItemSoldResult =
  | {
      outcome: "marked_sold";
      inventoryItemId: string;
      soldMarketplace: Marketplace | null;
      delist: QueueDelistResult;
    }
  | {
      outcome: "already_sold";
      inventoryItemId: string;
      soldMarketplace: Marketplace | null;
    }
  | {
      outcome: "conflict";
      inventoryItemId: string;
      soldMarketplace: Marketplace | null;
      conflictMarketplace: Marketplace;
      reviewTaskId: string;
    };

export async function markItemSold(
  db: MarkSoldPrismaLike = getPrisma(),
  input: MarkItemSoldInput,
): Promise<MarkItemSoldResult> {
  const inventoryOwnerUserId = input.inventoryOwnerUserId ?? input.userId;
  const item = await db.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: inventoryOwnerUserId },
    select: {
      id: true,
      sellerId: true,
      productName: true,
      status: true,
      soldSourceMarketplace: true,
      soldSourceListingId: true,
      lockVersion: true,
    },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  // Already sold: idempotent if same source, conflict if a different source.
  if (item.status === "SOLD" || item.soldSourceMarketplace) {
    const existingSource = item.soldSourceMarketplace;
    if (existingSource === input.soldMarketplace) {
      return {
        outcome: "already_sold",
        inventoryItemId: item.id,
        soldMarketplace: input.soldMarketplace,
      };
    }

    // Different source (or sold with no recorded source): never overwrite. An
    // unnamed (null) new source is described generically.
    const conflictMarketplace = existingSource ?? input.soldMarketplace;
    const conflictingLabel = input.soldMarketplace
      ? `from ${input.soldMarketplace}`
      : "from another source";
    const task = await createReviewTask(db, {
      userId: input.userId,
      type: "sync_conflict",
      inventoryItemId: item.id,
      marketplace: input.soldMarketplace,
      title: `Conflicting sale for "${item.productName}"`,
      description:
        `"${item.productName}" is already marked sold` +
        (existingSource ? ` on ${existingSource}` : "") +
        `, but a new sale signal arrived ${conflictingLabel}. ` +
        `Review which sale is real before any listing is changed.`,
      payload: {
        inventoryItemId: item.id,
        alreadySoldMarketplace: existingSource,
        conflictingMarketplace: input.soldMarketplace,
        conflictingListingId: input.soldListingId ?? null,
        source: input.source,
      } as Prisma.InputJsonValue,
    });

    await recordInventoryEvent(db, {
      inventoryItemId: item.id,
      userId: input.userId,
      type: "sync_conflict",
      source: input.source,
      marketplace: input.soldMarketplace,
      payload: {
        alreadySoldMarketplace: existingSource,
        conflictingMarketplace: input.soldMarketplace,
        reviewTaskId: task.id,
      } as Prisma.InputJsonValue,
    });

    // The seller-facing conflict notification only fires when both the existing
    // source and the conflicting source are named marketplaces.
    if (existingSource && input.soldMarketplace) {
      await createNotification(db, {
        userId: input.userId,
        inventoryItemId: item.id,
        ...syncConflictCopy({
          productName: item.productName,
          alreadySoldMarketplace: existingSource,
          conflictingMarketplace: input.soldMarketplace,
        }),
      });
    }

    return {
      outcome: "conflict",
      inventoryItemId: item.id,
      soldMarketplace: input.soldMarketplace,
      conflictMarketplace: conflictMarketplace as Marketplace,
      reviewTaskId: task.id,
    };
  }

  // Fresh sale: flip to SOLD, record the audit event, AND queue delist for every
  // OTHER live listing — all in ONE transaction. This is atomic on purpose: an
  // item can never end up SOLD without its delist jobs (no crash window between
  // commit and queueing that could strand a live listing on another marketplace).
  // The lockVersion guard makes two concurrent sales mutually exclusive — the
  // loser's update matches no row and throws, so it never double-sells.
  const now = new Date();
  let delist: QueueDelistResult;
  try {
    delist = await db.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id: item.id, lockVersion: item.lockVersion },
        data: {
          status: "SOLD",
          quantityAvailable: 0,
          soldAt: now,
          soldSourceMarketplace: input.soldMarketplace,
          soldSourceListingId: input.soldListingId ?? null,
          lockVersion: { increment: 1 },
        },
      });
      await recordInventoryEvent(tx, {
        inventoryItemId: item.id,
        userId: input.userId,
        type: "sale_confirmed",
        source: input.source,
        marketplace: input.soldMarketplace,
        payload: {
          soldMarketplace: input.soldMarketplace,
          soldListingId: input.soldListingId ?? null,
          soldPriceCents: input.soldPriceCents ?? null,
          source: input.source,
        } as Prisma.InputJsonValue,
      });
      return queueDelistOtherListings(
        tx,
        item.id,
        input.soldMarketplace,
        input.userId,
        inventoryOwnerUserId,
      );
    });
  } catch (error) {
    // A concurrent sale won the lockVersion race. Treat as already-sold (the
    // other writer is mid-flight); never overwrite or double-queue.
    if (isLockVersionConflict(error)) {
      return {
        outcome: "already_sold",
        inventoryItemId: item.id,
        soldMarketplace: input.soldMarketplace,
      };
    }
    throw error;
  }

  // Non-critical side effect, OUTSIDE the transaction: notifying the seller must
  // never roll back a completed sale.
  await createNotification(db, {
    userId: input.userId,
    inventoryItemId: item.id,
    ...soldDelistingCopy({
      productName: item.productName,
      soldMarketplace: input.soldMarketplace,
      // queuedJobIds holds ONLY auto-executable (eBay) jobs; non-eBay listings are
      // in manualReviewTaskIds. Keep the two distinct so we never tell the seller
      // we're auto-removing a listing we can't touch.
      autoDelistCount: delist.queuedJobIds.length,
      manualDelistCount: delist.manualReviewTaskIds.length,
    }),
  });

  return {
    outcome: "marked_sold",
    inventoryItemId: item.id,
    soldMarketplace: input.soldMarketplace,
    delist,
  };
}

// Prisma surfaces "record not found for the where clause" on an update as P2025.
function isLockVersionConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
