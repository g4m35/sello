import type {
  InventoryStatus,
  MarketplaceListingStatus,
  Prisma,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import { AppError, safePersistedFailureReason } from "@/lib/errors";
import { syncMasterStatusAfterMarketplaceDelist } from "@/lib/marketplace/lifecycle-sync";

import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { getEbayEnvironment } from "./adapters/ebay/config";
import {
  defaultEbayDelistDeps,
  delistEbayListing,
  type EbayDelistPrismaLike,
  type EbayDelistResult,
} from "./adapters/ebay/delist";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";
import {
  defaultStockXDelistDeps,
  delistStockXListing,
  type StockXDelistPrismaLike,
  type StockXDelistResult,
} from "./adapters/stockx/delist";
import { STOCKX_ENVIRONMENT } from "./adapters/stockx/types";
import {
  PublishingMigrationMissingError,
  publishingMigrationMissingCode,
  isUniqueConstraintViolation,
} from "./publish-handler";

export type DelistPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select?: { id: true; status?: true; sellerId?: true };
    }): Promise<{ id: string; status?: InventoryStatus; sellerId?: string } | null>;
    update(args: {
      where: { id: string };
      data: { status: InventoryStatus };
    }): Promise<unknown>;
  };
  marketplaceListing: {
    findFirst(args: {
      where: {
        inventoryItemId: string;
        marketplace: "ebay" | "stockx";
        environment: string;
      };
      select?: {
        id: true;
        status: true;
        sku: true;
        externalOfferId: true;
        externalListingId: true;
        lastError: true;
        publishAttempts: {
          select: { status: true; code: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      id: string;
      status: MarketplaceListingStatus | string;
      sku: string | null;
      externalOfferId: string | null;
      externalListingId: string | null;
      lastError: string | null;
      publishAttempts: Array<{ status: PublishAttemptStatus; code: string }>;
    } | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<{ id: string }>;
    findMany(args: {
      where: { inventoryItemId: string };
      select: { status: true };
    }): Promise<Array<{ status: string }>>;
  };
  publishAttempt: {
    create(args: {
      data: {
        marketplaceListingId: string;
        status: PublishAttemptStatus;
        idempotencyKey?: string | null;
        code: string;
        reason: string | null;
        adapterResult?: Prisma.InputJsonValue;
        requestedBy: string;
        completedAt?: Date | null;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: {
        status?: PublishAttemptStatus;
        code?: string;
        reason?: string | null;
        adapterResult?: Prisma.InputJsonValue;
        completedAt?: Date | null;
      };
    }): Promise<{ id: string }>;
  };
  marketplaceEvent: {
    create(args: {
      data: {
        marketplaceListingId: string;
        kind: string;
        data: Prisma.InputJsonValue;
      };
    }): Promise<{ id: string }>;
  };
};

export type ExecuteEbayDelistInput = {
  userId: string;
  accountId?: string;
  inventoryItemId: string;
  confirmLiveDelist: boolean;
};

export type ExecuteStockXDelistInput = ExecuteEbayDelistInput;

export type EbayDelistFn = (
  prisma: EbayDelistPrismaLike,
  input: {
    userId: string;
    accountId?: string;
    inventoryItemId: string;
    offerId: string;
    listingId: string | null;
  },
) => Promise<EbayDelistResult>;

const defaultEbayDelist: EbayDelistFn = (prisma, input) =>
  delistEbayListing(prisma, input, defaultEbayDelistDeps);

export type StockXDelistFn = (
  prisma: StockXDelistPrismaLike,
  input: {
    userId: string;
    accountId?: string;
    inventoryItemId: string;
    listingId: string;
  },
) => Promise<StockXDelistResult>;

const defaultStockXDelist: StockXDelistFn = (prisma, input) =>
  delistStockXListing(prisma, input, defaultStockXDelistDeps);

export async function executeEbayDelist(
  prisma: DelistPrismaLike,
  input: ExecuteEbayDelistInput,
  ebayDelist: EbayDelistFn = defaultEbayDelist,
) {
  if (!input.confirmLiveDelist) {
    throw new AppError(
      "Confirm that this ends the live eBay listing before continuing.",
      400,
    );
  }

  assertDelistPersistenceDelegates(prisma);

  const item = await prisma.inventoryItem.findFirst({
    where: input.accountId
      ? { id: input.inventoryItemId, accountId: input.accountId }
      : { id: input.inventoryItemId, sellerId: input.userId },
    select: { id: true, status: true, sellerId: true },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const environment = getEbayEnvironment();
  const listing = await prisma.marketplaceListing.findFirst({
    where: {
      inventoryItemId: item.id,
      marketplace: "ebay",
      environment,
    },
    select: {
      id: true,
      status: true,
      sku: true,
      externalOfferId: true,
      externalListingId: true,
      lastError: true,
      publishAttempts: {
        select: { status: true, code: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  assertCanDelist(listing);

  const idempotencyKey = `${input.inventoryItemId}:ebay:${environment}:delist`;
  const startedAt = new Date();
  let attempt: { id: string };
  try {
    attempt = await withMigrationDetection(async () => {
      const created = await prisma.publishAttempt.create({
        data: {
          marketplaceListingId: listing.id,
          status: "RUNNING",
          idempotencyKey,
          code: "EBAY_DELIST_STARTED",
          reason: null,
          adapterResult: null as unknown as Prisma.InputJsonValue,
          requestedBy: input.userId,
          completedAt: null,
        },
      });
      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "delist_started",
          data: {
            attemptId: created.id,
            marketplace: "ebay",
            environment,
            idempotencyKey,
            offerId: listing.externalOfferId,
            listingId: listing.externalListingId,
            startedAt: startedAt.toISOString(),
          },
        },
      });
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: { status: "DELISTING", lastError: null },
      });
      return created;
    });
  } catch (error) {
    // The same partial unique index that guards publish guards delist: two
    // concurrent delists that race past assertCanDelist collide here, before any
    // outbound eBay withdraw call. Surface the loser as the typed 409.
    if (isUniqueConstraintViolation(error)) {
      throw new EbayIntegrationError(
        ebayErrorCodes.delistFailed,
        "An eBay delist operation is already running for this item.",
        409,
        { marketplaceListingId: listing.id, idempotencyKey },
      );
    }
    throw error;
  }

  let result: EbayDelistResult;
  try {
    result = await ebayDelist(prisma as unknown as EbayDelistPrismaLike, {
      userId: input.userId,
      accountId: input.accountId,
      inventoryItemId: input.inventoryItemId,
      offerId: listing.externalOfferId!,
      listingId: listing.externalListingId,
    });
  } catch (error) {
    await recordEbayDelistFailure(prisma, listing.id, attempt.id, error);
    throw error;
  }

  return withMigrationDetection(async () => {
    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SUCCEEDED",
        code: result.code,
        reason: null,
        adapterResult: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "ebay_offer_withdrawn",
        data: {
          attemptId: attempt.id,
          marketplace: "ebay",
          environment,
          offerId: result.offerId,
          listingId: result.listingId,
        },
      },
    });

    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "DELISTED",
        lastSyncAt: new Date(),
        lastError: null,
      },
    });
    await syncMasterStatusAfterMarketplaceDelist(prisma, input.inventoryItemId);

    return {
      ok: true as const,
      httpStatus: 200,
      ...result,
      marketplaceListingId: listing.id,
      publishAttemptId: attempt.id,
    };
  });
}

export async function executeStockXDelist(
  prisma: DelistPrismaLike,
  input: ExecuteStockXDelistInput,
  stockxDelist: StockXDelistFn = defaultStockXDelist,
) {
  if (!input.confirmLiveDelist) {
    throw new AppError(
      "Confirm that this ends the live StockX listing before continuing.",
      400,
    );
  }

  assertDelistPersistenceDelegates(prisma);

  const item = await prisma.inventoryItem.findFirst({
    where: input.accountId
      ? { id: input.inventoryItemId, accountId: input.accountId }
      : { id: input.inventoryItemId, sellerId: input.userId },
    select: { id: true, status: true, sellerId: true },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const listing = await prisma.marketplaceListing.findFirst({
    where: {
      inventoryItemId: item.id,
      marketplace: "stockx",
      environment: STOCKX_ENVIRONMENT,
    },
    select: {
      id: true,
      status: true,
      sku: true,
      externalOfferId: true,
      externalListingId: true,
      lastError: true,
      publishAttempts: {
        select: { status: true, code: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  assertCanStockXDelist(listing);

  const idempotencyKey = `${input.inventoryItemId}:stockx:${STOCKX_ENVIRONMENT}:delist`;
  const startedAt = new Date();
  let attempt: { id: string };
  try {
    attempt = await withMigrationDetection(async () => {
      const created = await prisma.publishAttempt.create({
        data: {
          marketplaceListingId: listing.id,
          status: "RUNNING",
          idempotencyKey,
          code: stockxErrorCodes.delistStarted,
          reason: null,
          adapterResult: null as unknown as Prisma.InputJsonValue,
          requestedBy: input.userId,
          completedAt: null,
        },
      });
      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "delist_started",
          data: {
            attemptId: created.id,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
            idempotencyKey,
            listingId: listing.externalListingId,
            startedAt: startedAt.toISOString(),
          },
        },
      });
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: { status: "DELISTING", lastError: null },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new StockXIntegrationError(
        stockxErrorCodes.delistFailed,
        "A StockX delist operation is already running for this item.",
        409,
        { marketplaceListingId: listing.id, idempotencyKey },
      );
    }
    throw error;
  }

  let result: StockXDelistResult;
  try {
    result = await stockxDelist(prisma as unknown as StockXDelistPrismaLike, {
      userId: input.userId,
      accountId: input.accountId,
      inventoryItemId: input.inventoryItemId,
      listingId: listing.externalListingId!,
    });
  } catch (error) {
    await recordStockXDelistFailure(prisma, listing.id, attempt.id, error);
    throw error;
  }

  return withMigrationDetection(async () => {
    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SUCCEEDED",
        code: result.code,
        reason: null,
        adapterResult: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "stockx_listing_deactivated",
        data: {
          attemptId: attempt.id,
          marketplace: "stockx",
          environment: STOCKX_ENVIRONMENT,
          listingId: result.listingId,
          operationId: result.operationId,
          operationStatus: result.operationStatus,
        },
      },
    });

    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "DELISTED",
        metadata: {
          operationId: result.operationId,
          operationStatus: result.operationStatus,
          operationUrl: result.operationUrl,
        },
        lastSyncAt: new Date(),
        lastError: null,
        endedAt: new Date(),
      },
    });
    await syncMasterStatusAfterMarketplaceDelist(prisma, input.inventoryItemId);

    return {
      ok: true as const,
      httpStatus: 200,
      ...result,
      marketplaceListingId: listing.id,
      publishAttemptId: attempt.id,
    };
  });
}

function assertCanDelist(
  listing: Awaited<ReturnType<DelistPrismaLike["marketplaceListing"]["findFirst"]>>,
): asserts listing is NonNullable<typeof listing> {
  if (!listing) {
    throw new EbayIntegrationError(
      ebayErrorCodes.delistFailed,
      "No published eBay listing exists for this item.",
      409,
    );
  }

  if (listing.status === "DELISTED") {
    throw new EbayIntegrationError(
      ebayErrorCodes.delistFailed,
      "This eBay listing is already marked delisted.",
      409,
    );
  }

  const duplicate = listing.publishAttempts.find(
    (attempt) =>
      attempt.code.startsWith("EBAY_DELIST") &&
      ["QUEUED", "RUNNING"].includes(attempt.status),
  );
  if (duplicate) {
    throw new EbayIntegrationError(
      ebayErrorCodes.delistFailed,
      "An eBay delist operation is already running for this item.",
      409,
      { blockingAttemptStatus: duplicate.status },
    );
  }

  if (
    listing.status !== "LISTED" ||
    !listing.externalOfferId ||
    !listing.externalListingId
  ) {
    throw new EbayIntegrationError(
      ebayErrorCodes.delistFailed,
      "No published eBay listing with stored eBay IDs exists for this item.",
      409,
      {
        status: listing.status,
        hasOfferId: Boolean(listing.externalOfferId),
        hasListingId: Boolean(listing.externalListingId),
      },
    );
  }
}

function assertCanStockXDelist(
  listing: Awaited<ReturnType<DelistPrismaLike["marketplaceListing"]["findFirst"]>>,
): asserts listing is NonNullable<typeof listing> {
  if (!listing) {
    throw new StockXIntegrationError(
      stockxErrorCodes.delistFailed,
      "No StockX listing exists for this item.",
      409,
    );
  }

  if (listing.status === "DELISTED") {
    throw new StockXIntegrationError(
      stockxErrorCodes.delistFailed,
      "This StockX listing is already marked ended.",
      409,
    );
  }

  const duplicate = listing.publishAttempts.find(
    (attempt) =>
      attempt.code.startsWith("STOCKX_DELIST") &&
      ["QUEUED", "RUNNING"].includes(attempt.status),
  );
  if (duplicate) {
    throw new StockXIntegrationError(
      stockxErrorCodes.delistFailed,
      "A StockX delist operation is already running for this item.",
      409,
      { blockingAttemptStatus: duplicate.status },
    );
  }

  if (
    !["LISTING", "LISTED"].includes(listing.status) ||
    !listing.externalListingId
  ) {
    throw new StockXIntegrationError(
      stockxErrorCodes.delistFailed,
      "No active StockX listing with a stored listing ID exists for this item.",
      409,
      {
        status: listing.status,
        hasListingId: Boolean(listing.externalListingId),
      },
    );
  }
}

async function recordEbayDelistFailure(
  prisma: DelistPrismaLike,
  marketplaceListingId: string,
  publishAttemptId: string,
  error: unknown,
) {
  const code =
    error instanceof EbayIntegrationError ? error.code : ebayErrorCodes.delistFailed;
  // Sanitized before persisting to publishAttempt.reason and marketplaceListing.lastError.
  const reason = safePersistedFailureReason(error, "eBay could not end this listing.");

  await withMigrationDetection(async () => {
    await prisma.publishAttempt.update({
      where: { id: publishAttemptId },
      data: {
        status: "FAILED",
        code,
        reason,
        adapterResult: { code } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId,
        kind: "delist_failed",
        data: { code, attemptId: publishAttemptId, marketplace: "ebay" },
      },
    });

    await prisma.marketplaceListing.update({
      where: { id: marketplaceListingId },
      data: { status: "LISTED", lastError: reason },
    });
  });
}

async function recordStockXDelistFailure(
  prisma: DelistPrismaLike,
  marketplaceListingId: string,
  publishAttemptId: string,
  error: unknown,
) {
  const code =
    error instanceof StockXIntegrationError
      ? error.code
      : stockxErrorCodes.delistFailed;
  const reason = safePersistedFailureReason(
    error,
    "StockX could not end this listing.",
  );

  await withMigrationDetection(async () => {
    await prisma.publishAttempt.update({
      where: { id: publishAttemptId },
      data: {
        status: "FAILED",
        code,
        reason,
        adapterResult: { code } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId,
        kind: "delist_failed",
        data: { code, attemptId: publishAttemptId, marketplace: "stockx" },
      },
    });

    await prisma.marketplaceListing.update({
      where: { id: marketplaceListingId },
      data: { status: "LISTED", lastError: reason },
    });
  });
}

async function withMigrationDetection<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PublishingMigrationMissingError) {
      throw error;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "P2021" || error.code === "42P01")
    ) {
      throw new PublishingMigrationMissingError();
    }
    throw error;
  }
}

function assertDelistPersistenceDelegates(prisma: DelistPrismaLike) {
  if (
    typeof prisma.publishAttempt?.create !== "function" ||
    typeof prisma.publishAttempt?.update !== "function" ||
    typeof prisma.marketplaceEvent?.create !== "function" ||
    typeof prisma.marketplaceListing?.update !== "function"
  ) {
    throw new AppError(
      "Publishing persistence is not ready.",
      503,
      publishingMigrationMissingCode,
    );
  }
}
