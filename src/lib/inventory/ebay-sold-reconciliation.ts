import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { recordInventoryEvent, type InventoryEventPrismaLike } from "@/lib/inventory/events";
import { markItemSold, type MarkItemSoldResult, type MarkSoldPrismaLike } from "@/lib/inventory/mark-sold";
import {
  createNotification,
  possibleSaleConfirmCopy,
  type NotificationPrismaLike,
} from "@/lib/inventory/notifications";
import { createReviewTask, type ReviewTaskPrismaLike } from "@/lib/inventory/review-tasks";
import { getPrisma } from "@/lib/prisma";

export type EbayPaymentStatus =
  | "PAID"
  | "PENDING"
  | "FAILED"
  | "FULLY_REFUNDED"
  | "PARTIALLY_REFUNDED"
  | string;

export type EbayFulfillmentStatus = "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED" | string;

export type EbaySoldSignal = {
  accountId: string;
  actorUserId: string;
  environment: "sandbox" | "production";
  externalEventId: string;
  externalOrderId: string;
  externalLineItemId: string;
  externalListingId: string;
  paymentStatus: EbayPaymentStatus;
  fulfillmentStatus: EbayFulfillmentStatus;
  cancelState: string;
  quantity: number;
  soldPriceCents?: number | null;
  occurredAt?: Date | null;
  verifiedSource: boolean;
};

export type EbaySignalState = "confirmed_sold" | "canceled" | "refunded" | "uncertain";

export function classifyEbaySoldSignal(input: EbaySoldSignal): EbaySignalState {
  if (!input.verifiedSource) return "uncertain";
  if (input.paymentStatus === "FULLY_REFUNDED") return "refunded";
  const cancel = input.cancelState.toUpperCase();
  if (
    (cancel.includes("CANCELED") || cancel.includes("CANCELLED")) &&
    !cancel.includes("REJECTED") &&
    cancel !== "NONE_REQUESTED"
  ) {
    return "canceled";
  }
  if (input.paymentStatus === "PARTIALLY_REFUNDED") return "uncertain";
  if (
    input.paymentStatus === "PAID" &&
    input.cancelState === "NONE_REQUESTED" &&
    input.quantity === 1 &&
    ["NOT_STARTED", "IN_PROGRESS", "FULFILLED"].includes(input.fulfillmentStatus)
  ) {
    return "confirmed_sold";
  }
  return "uncertain";
}

type ListingRow = {
  id: string;
  inventoryItemId: string;
  externalListingId: string | null;
  titleSnapshot: string | null;
  inventoryItem: { sellerId: string; accountId: string | null; productName: string };
};

type SignalRow = {
  id: string;
  state: string;
  outcome: string | null;
  inventoryItemId: string | null;
  processedAt: Date | null;
};

export type EbaySoldReconciliationPrismaLike = MarkSoldPrismaLike &
  ReviewTaskPrismaLike &
  NotificationPrismaLike &
  InventoryEventPrismaLike & {
    marketplaceListing: MarkSoldPrismaLike["marketplaceListing"] & {
      findFirst(args: {
        where: {
          marketplace: "ebay";
          externalListingId: string;
          inventoryItem: { accountId: string };
        };
        select: {
          id: true;
          inventoryItemId: true;
          externalListingId: true;
          titleSnapshot: true;
          inventoryItem: {
            select: { sellerId: true; accountId: true; productName: true };
          };
        };
      }): Promise<ListingRow | null>;
    };
    marketplaceSaleSignal: {
      create(args: {
        data: {
          accountId: string;
          marketplace: "ebay";
          environment: string;
          externalEventId: string;
          externalOrderId: string;
          externalLineItemId: string;
          externalListingId: string;
          state: string;
          sanitizedPayload: Prisma.InputJsonValue;
        };
        select: { id: true };
      }): Promise<{ id: string }>;
      findUnique(args: {
        where: {
          accountId_marketplace_environment_externalEventId: {
            accountId: string;
            marketplace: "ebay";
            environment: string;
            externalEventId: string;
          };
        };
        select: {
          id: true;
          state: true;
          outcome: true;
          inventoryItemId: true;
          processedAt: true;
        };
      }): Promise<SignalRow | null>;
      update(args: {
        where: { id: string };
        data: {
          inventoryItemId?: string | null;
          state?: string;
          outcome: string;
          processedAt: Date;
        };
      }): Promise<{ id: string }>;
    };
  };

export type EbayReconciliationResult =
  | { outcome: "duplicate"; signalId: string; priorOutcome: string | null }
  | { outcome: "review_unmatched" | "review_uncertain"; signalId: string; reviewTaskId: string }
  | { outcome: "ignored_canceled" | "ignored_refunded"; signalId: string; inventoryItemId: string }
  | {
      outcome: "marked_sold" | "already_sold" | "conflict";
      signalId: string;
      inventoryItemId: string;
      markSold: MarkItemSoldResult;
    };

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

export async function reconcileEbaySoldSignal(
  db: EbaySoldReconciliationPrismaLike = getPrisma(),
  input: EbaySoldSignal,
): Promise<EbayReconciliationResult> {
  const state = classifyEbaySoldSignal(input);
  let signalId: string;
  try {
    const created = await db.marketplaceSaleSignal.create({
      data: {
        accountId: input.accountId,
        marketplace: "ebay",
        environment: input.environment,
        externalEventId: input.externalEventId,
        externalOrderId: input.externalOrderId,
        externalLineItemId: input.externalLineItemId,
        externalListingId: input.externalListingId,
        state,
        sanitizedPayload: {
          paymentStatus: input.paymentStatus,
          fulfillmentStatus: input.fulfillmentStatus,
          cancelState: input.cancelState,
          quantity: input.quantity,
          occurredAt: input.occurredAt?.toISOString() ?? null,
          verifiedSource: input.verifiedSource,
        },
      },
      select: { id: true },
    });
    signalId = created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const duplicate = await db.marketplaceSaleSignal.findUnique({
      where: {
        accountId_marketplace_environment_externalEventId: {
          accountId: input.accountId,
          marketplace: "ebay",
          environment: input.environment,
          externalEventId: input.externalEventId,
        },
      },
      select: {
        id: true,
        state: true,
        outcome: true,
        inventoryItemId: true,
        processedAt: true,
      },
    });
    if (!duplicate) throw new AppError("Sale signal deduplication failed.", 409, "SALE_SIGNAL_DEDUPE_FAILED");
    return { outcome: "duplicate", signalId: duplicate.id, priorOutcome: duplicate.outcome };
  }

  const listing = await db.marketplaceListing.findFirst({
    where: {
      marketplace: "ebay",
      externalListingId: input.externalListingId,
      inventoryItem: { accountId: input.accountId },
    },
    select: {
      id: true,
      inventoryItemId: true,
      externalListingId: true,
      titleSnapshot: true,
      inventoryItem: { select: { sellerId: true, accountId: true, productName: true } },
    },
  });

  if (!listing) {
    const task = await createReviewTask(db, {
      userId: input.actorUserId,
      accountId: input.accountId,
      type: "sync_conflict",
      marketplace: "ebay",
      title: "Review an unmatched eBay order",
      description: "A verified eBay order signal could not be matched to an account listing.",
      payload: {
        saleSignalId: signalId,
        externalOrderId: input.externalOrderId,
        externalLineItemId: input.externalLineItemId,
        state,
      },
    });
    await db.marketplaceSaleSignal.update({
      where: { id: signalId },
      data: { outcome: "review_unmatched", processedAt: new Date() },
    });
    return { outcome: "review_unmatched", signalId, reviewTaskId: task.id };
  }

  if (state === "canceled" || state === "refunded") {
    await recordInventoryEvent(db, {
      inventoryItemId: listing.inventoryItemId,
      userId: input.actorUserId,
      accountId: input.accountId,
      type: "sale_rejected",
      source: "api",
      marketplace: "ebay",
      externalEventId: input.externalEventId,
      correlationId: input.externalOrderId,
      payload: { saleSignalId: signalId, state, externalOrderId: input.externalOrderId },
    });
    const outcome = state === "canceled" ? "ignored_canceled" : "ignored_refunded";
    await db.marketplaceSaleSignal.update({
      where: { id: signalId },
      data: {
        inventoryItemId: listing.inventoryItemId,
        outcome,
        processedAt: new Date(),
      },
    });
    return { outcome, signalId, inventoryItemId: listing.inventoryItemId };
  }

  if (state === "uncertain") {
    const task = await createReviewTask(db, {
      userId: input.actorUserId,
      accountId: input.accountId,
      type: "confirm_possible_sale",
      inventoryItemId: listing.inventoryItemId,
      marketplace: "ebay",
      title: `Confirm the eBay order for "${listing.inventoryItem.productName}"`,
      description:
        "The eBay order is not confirmed enough for automatic delisting. Review payment, cancellation, and refund status.",
      payload: { saleSignalId: signalId, state },
    });
    await createNotification(db, {
      userId: input.actorUserId,
      accountId: input.accountId,
      inventoryItemId: listing.inventoryItemId,
      ...possibleSaleConfirmCopy({
        productName: listing.inventoryItem.productName,
        marketplace: "ebay",
      }),
    });
    await db.marketplaceSaleSignal.update({
      where: { id: signalId },
      data: {
        inventoryItemId: listing.inventoryItemId,
        outcome: "review_uncertain",
        processedAt: new Date(),
      },
    });
    return { outcome: "review_uncertain", signalId, reviewTaskId: task.id };
  }

  const markSold = await markItemSold(db, {
    inventoryItemId: listing.inventoryItemId,
    accountId: input.accountId,
    userId: input.actorUserId,
    inventoryOwnerUserId: listing.inventoryItem.sellerId,
    soldMarketplace: "ebay",
    soldListingId: input.externalListingId,
    sourceMarketplaceListingId: listing.id,
    soldPriceCents: input.soldPriceCents ?? null,
    source: "api",
  });
  await db.marketplaceSaleSignal.update({
    where: { id: signalId },
    data: {
      inventoryItemId: listing.inventoryItemId,
      outcome: markSold.outcome,
      processedAt: new Date(),
    },
  });
  return {
    outcome: markSold.outcome,
    signalId,
    inventoryItemId: listing.inventoryItemId,
    markSold,
  };
}
