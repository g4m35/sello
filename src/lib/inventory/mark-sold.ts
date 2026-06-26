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

export type MarkSoldTransaction = InventoryEventPrismaLike & {
  inventoryItem: {
    update(args: {
      where: { id: string; lockVersion: number };
      data: {
        status: InventoryStatus;
        quantityAvailable: number;
        soldAt: Date;
        soldSourceMarketplace: Marketplace;
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
  soldMarketplace: Marketplace;
  soldListingId?: string | null;
  soldPriceCents?: number | null;
  source: "api" | "email" | "manual" | "system";
};

export type MarkItemSoldResult =
  | {
      outcome: "marked_sold";
      inventoryItemId: string;
      soldMarketplace: Marketplace;
      delist: QueueDelistResult;
    }
  | {
      outcome: "already_sold";
      inventoryItemId: string;
      soldMarketplace: Marketplace;
    }
  | {
      outcome: "conflict";
      inventoryItemId: string;
      soldMarketplace: Marketplace;
      conflictMarketplace: Marketplace;
      reviewTaskId: string;
    };

export async function markItemSold(
  db: MarkSoldPrismaLike = getPrisma(),
  input: MarkItemSoldInput,
): Promise<MarkItemSoldResult> {
  const item = await db.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: input.userId },
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

    // Different source (or sold with no recorded source): never overwrite.
    const conflictMarketplace = existingSource ?? input.soldMarketplace;
    const task = await createReviewTask(db, {
      userId: input.userId,
      type: "sync_conflict",
      inventoryItemId: item.id,
      marketplace: input.soldMarketplace,
      title: `Conflicting sale for "${item.productName}"`,
      description:
        `"${item.productName}" is already marked sold` +
        (existingSource ? ` on ${existingSource}` : "") +
        `, but a new sale signal arrived from ${input.soldMarketplace}. ` +
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

    if (existingSource) {
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
      conflictMarketplace,
      reviewTaskId: task.id,
    };
  }

  // Fresh sale: flip to SOLD and record the audit event atomically. The
  // lockVersion guard makes two concurrent sales mutually exclusive — the loser's
  // update matches no row and throws, so it never double-sells.
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
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

  // Post-commit, idempotent side effects: queue delist for every OTHER live
  // listing and notify the seller. Safe to repeat — sync jobs upsert on key.
  const delist = await queueDelistOtherListings(
    db,
    item.id,
    input.soldMarketplace,
    input.userId,
  );

  await createNotification(db, {
    userId: input.userId,
    inventoryItemId: item.id,
    ...soldDelistingCopy({
      productName: item.productName,
      soldMarketplace: input.soldMarketplace,
      otherMarketplaceCount: delist.queuedJobIds.length,
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
