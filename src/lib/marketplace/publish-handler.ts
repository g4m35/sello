import type {
  InventoryStatus,
  Prisma,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import type { Marketplace } from "@/lib/ai/listing-draft";
import {
  AppError,
  safeFailureText,
  safePersistedFailureReason,
} from "@/lib/errors";
import { TERMINAL_PUBLISH_STATUSES } from "@/lib/lifecycle/item-status";
import { syncMasterStatusAfterMarketplacePublish } from "@/lib/marketplace/lifecycle-sync";

import { getMarketplaceAdapter, type PublishOutcome } from "./adapter";
import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { getEbayEnvironment } from "./adapters/ebay/config";
import {
  defaultEbayPublishDeps,
  publishEbayListing,
  type EbayPublishPrismaLike,
  type EbayPublishResult,
  type EbayPublishStepRecord,
} from "./adapters/ebay/publish";
import { STOCKX_ENVIRONMENT } from "./adapters/stockx/types";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";
import {
  defaultStockXPublishDeps,
  publishStockXListing,
  type StockXPublishPrismaLike,
  type StockXPublishResult,
} from "./adapters/stockx/publish";

const publishingPersistenceTables = ["PublishAttempt", "MarketplaceEvent"] as const;

export const publishingMigrationMissingCode = "PUBLISHING_MIGRATION_MISSING";

export class PublishingMigrationMissingError extends AppError {
  readonly missingTables: readonly string[];

  constructor() {
    super(
      "Publishing persistence is not ready yet. Apply the migration that creates PublishAttempt and MarketplaceEvent, then retry. Nothing was published.",
      503,
      publishingMigrationMissingCode,
    );
    this.name = "PublishingMigrationMissingError";
    this.missingTables = publishingPersistenceTables;
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      missingTables: [...this.missingTables],
    };
  }
}

// Structural subset of the Prisma client this handler needs. Keeping it narrow
// lets the unit tests use a tiny in-memory fake without dragging in the full
// client surface.
export type PublishPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select?: { id: true; status: true };
    }): Promise<{ id: string; status: InventoryStatus } | null>;
    update?(args: {
      where: { id: string };
      data: { status: InventoryStatus };
    }): Promise<unknown>;
  };
  marketplaceListing: {
    findFirst?(args: {
      where: {
        inventoryItemId: string;
        marketplace: Marketplace;
        environment: string;
      };
      select?: {
        id: true;
        status?: true;
        sku?: true;
        externalOfferId?: true;
        externalListingId?: true;
        publishAttempts?: {
          select: { status: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      id: string;
      status?: string;
      sku?: string | null;
      externalOfferId?: string | null;
      externalListingId?: string | null;
      publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
    } | null>;
    create?(args: {
      data: {
        inventoryItemId: string;
        marketplace: Marketplace;
        environment: string;
        status?: "NOT_LISTED";
      };
      select?: {
        id: true;
        status?: true;
        sku?: true;
        externalOfferId?: true;
        externalListingId?: true;
        publishAttempts?: {
          select: { status: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      id: string;
      status?: string;
      sku?: string | null;
      externalOfferId?: string | null;
      externalListingId?: string | null;
      publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
    }>;
    upsert(args: {
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: string;
          marketplace: Marketplace;
          environment: string;
        };
      };
      create: {
        inventoryItemId: string;
        marketplace: Marketplace;
        environment: string;
        status?: "NOT_LISTED";
      };
      update: Record<string, never>;
      select?: {
        id: true;
        status?: true;
        sku?: true;
        externalOfferId?: true;
        externalListingId?: true;
        publishAttempts?: {
          select: { status: true };
          orderBy: { createdAt: "desc" };
          take: number;
        };
      };
    }): Promise<{
      id: string;
      status?: string;
      sku?: string | null;
      externalOfferId?: string | null;
      externalListingId?: string | null;
      publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
    }>;
    update?(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<{ id: string }>;
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
    update?(args: {
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

export type ExecutePublishInput = {
  userId: string;
  accountId?: string;
  inventoryItemId: string;
  marketplace: Marketplace;
  bulkRunId?: string;
  confirmLivePublish?: boolean;
};

export type ExecutePublishResult = {
  ok: true;
  httpStatus: number;
  outcome: PublishOutcome | EbayPublishResult | StockXPublishResult;
  marketplaceListingId: string;
  publishAttemptId: string;
  sku?: string;
  offerId?: string;
  listingId?: string;
};

type AdapterResolver = (marketplace: Marketplace) => {
  publishDraft(args: { inventoryItemId: string }): Promise<PublishOutcome>;
};

export type EbayPublishFn = (
  prisma: EbayPublishPrismaLike,
  input: { userId: string; accountId?: string; inventoryItemId: string },
) => Promise<EbayPublishResult>;

const defaultEbayPublish: EbayPublishFn = (prisma, input) =>
  publishEbayListing(prisma, input, defaultEbayPublishDeps);

export type StockXPublishFn = (
  prisma: StockXPublishPrismaLike,
  input: {
    userId: string;
    accountId?: string;
    inventoryItemId: string;
    confirmLivePublish?: boolean;
  },
) => Promise<StockXPublishResult>;

const defaultStockXPublish: StockXPublishFn = (prisma, input) =>
  publishStockXListing(prisma, input, defaultStockXPublishDeps);

// Persists a single publish attempt for an approved item. For non-eBay
// marketplaces it returns the honest NOT_IMPLEMENTED outcome. For eBay it runs
// the guarded environment-specific publish flow and records the typed outcome.
// Throws typed AppError for 404/409 so the thin route handler can map them
// uniformly.
export async function executePublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  resolveAdapter: AdapterResolver = getMarketplaceAdapter,
  ebayPublish: EbayPublishFn = defaultEbayPublish,
  stockxPublish: StockXPublishFn = defaultStockXPublish,
): Promise<ExecutePublishResult> {
  const item = await prisma.inventoryItem.findFirst({
    where: input.accountId
      ? { id: input.inventoryItemId, accountId: input.accountId }
      : { id: input.inventoryItemId, sellerId: input.userId },
    select: { id: true, status: true },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  // Readiness is computed from the listing fields, not a manual "ready"/approved
  // status: the eBay adapter re-checks content + account readiness and returns the
  // exact missing fields, so there is no separate "mark ready" step. Only a
  // genuinely terminal item (already sold or archived) is blocked here.
  if (TERMINAL_PUBLISH_STATUSES.includes(item.status)) {
    throw new AppError("This item can no longer be published.", 409);
  }

  assertPublishingPersistenceDelegates(prisma);

  const environment =
    input.marketplace === "ebay"
      ? getEbayEnvironment()
      : input.marketplace === "stockx"
        ? STOCKX_ENVIRONMENT
        : "manual";
  const listing = await getOrCreateMarketplaceListing(
    prisma,
    item.id,
    input.marketplace,
    environment,
  );

  if (input.marketplace === "ebay") {
    return executeEbayPublish(prisma, input, listing, environment, ebayPublish);
  }

  if (input.marketplace === "stockx") {
    return executeStockXPublish(prisma, input, listing, stockxPublish);
  }

  const outcome = await resolveAdapter(input.marketplace).publishDraft({
    inventoryItemId: item.id,
  });
  const completedAt = new Date();

  return withMigrationDetection(async () => {
    const attempt = await prisma.publishAttempt.create({
      data: {
        marketplaceListingId: listing.id,
        status: "NOT_IMPLEMENTED",
        code: outcome.code,
        reason: outcome.reason,
        adapterResult: {
          ...outcome,
          ...bulkRunMetadata(input.bulkRunId),
        } as unknown as Prisma.InputJsonValue,
        requestedBy: input.userId,
        completedAt,
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "publish_attempted",
        data: {
          code: outcome.code,
          status: "NOT_IMPLEMENTED",
          attemptId: attempt.id,
          marketplace: input.marketplace,
          ...bulkRunMetadata(input.bulkRunId),
        },
      },
    });

    return {
      ok: true,
      httpStatus: 501,
      outcome,
      marketplaceListingId: listing.id,
      publishAttemptId: attempt.id,
    };
  });
}

async function getOrCreateMarketplaceListing(
  prisma: PublishPrismaLike,
  inventoryItemId: string,
  marketplace: Marketplace,
  environment: string,
) {
  const select = {
    id: true,
    status: true,
    sku: true,
    externalOfferId: true,
    externalListingId: true,
    publishAttempts: {
      select: { status: true, code: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    },
  } as const;

  if (prisma.marketplaceListing.findFirst && prisma.marketplaceListing.create) {
    const existing = await prisma.marketplaceListing.findFirst({
      where: { inventoryItemId, marketplace, environment },
      select,
    });
    if (existing) return existing;
    return prisma.marketplaceListing.create({
      data: { inventoryItemId, marketplace, environment, status: "NOT_LISTED" },
      select,
    });
  }

  return prisma.marketplaceListing.upsert({
    where: {
      inventoryItemId_marketplace_environment: {
        inventoryItemId,
        marketplace,
        environment,
      },
    },
    create: {
      inventoryItemId,
      marketplace,
      environment,
      status: "NOT_LISTED",
    },
    update: {},
    select,
  });
}

async function executeEbayPublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  listing: {
    id: string;
    status?: string;
    sku?: string | null;
    externalOfferId?: string | null;
    externalListingId?: string | null;
    publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
  },
  environment: string,
  ebayPublish: EbayPublishFn,
): Promise<ExecutePublishResult> {
  assertEbayPublishNotDuplicate(listing);

  const idempotencyKey = `${input.inventoryItemId}:ebay:${environment}`;
  const startedAt = new Date();
  let attempt: { id: string };
  try {
    attempt = await withMigrationDetection(async () => {
      const created = await prisma.publishAttempt.create({
        data: {
          marketplaceListingId: listing.id,
          status: "RUNNING",
          idempotencyKey,
          code: "EBAY_PUBLISH_STARTED",
          reason: null,
          adapterResult: (input.bulkRunId === undefined
            ? null
            : { bulkRunId: input.bulkRunId }) as unknown as Prisma.InputJsonValue,
          requestedBy: input.userId,
          completedAt: null,
        },
      });
      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "publish_started",
          data: {
            attemptId: created.id,
            marketplace: "ebay",
            environment,
            idempotencyKey,
            startedAt: startedAt.toISOString(),
            ...bulkRunMetadata(input.bulkRunId),
          },
        },
      });
      return created;
    });
  } catch (error) {
    // The partial unique index on PublishAttempt(marketplaceListingId,
    // idempotencyKey) WHERE status IN (QUEUED, RUNNING, SUCCEEDED) is the DB-level
    // guard against two concurrent publishes both passing the in-memory check.
    // The race loser hits the constraint here, before any outbound eBay call.
    if (isUniqueConstraintViolation(error)) {
      throw new EbayIntegrationError(
        ebayErrorCodes.alreadyPublished,
        "This item already has an in-flight or completed eBay publish attempt. Refusing to create a duplicate listing.",
        409,
        { marketplaceListingId: listing.id, idempotencyKey },
      );
    }
    throw error;
  }

  let result: EbayPublishResult;
  try {
    result = await ebayPublish(prisma as unknown as EbayPublishPrismaLike, {
      userId: input.userId,
      accountId: input.accountId,
      inventoryItemId: input.inventoryItemId,
    });
  } catch (error) {
    await recordEbayFailure(
      prisma,
      listing.id,
      attempt.id,
      error,
      input.bulkRunId,
    );
    throw error;
  }

  if (result.status === "not_enabled") {
    return withMigrationDetection(async () => {
      await updatePublishAttempt(prisma, attempt.id, {
        status: "NOT_IMPLEMENTED",
        code: result.code,
        reason: result.message,
        adapterResult: {
          ...result,
          ...bulkRunMetadata(input.bulkRunId),
        } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      });

      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "publish_blocked",
          data: {
            code: result.code,
            attemptId: attempt.id,
            marketplace: "ebay",
            environment,
            ...bulkRunMetadata(input.bulkRunId),
          },
        },
      });

      return {
        ok: true,
        httpStatus: environment === "production" ? 403 : 200,
        outcome: result,
        marketplaceListingId: listing.id,
        publishAttemptId: attempt.id,
      };
    });
  }

  // result.status === "published"
  return withMigrationDetection(async () => {
    await updatePublishAttempt(prisma, attempt.id, {
      status: "SUCCEEDED",
      code: result.code,
      reason: null,
      adapterResult: {
        ...result,
        ...bulkRunMetadata(input.bulkRunId),
      } as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    });

    const steps: Array<{ kind: string; data: Prisma.InputJsonValue }> = [
      ...(result.steps ?? []).map((step) => ({
        kind: `ebay_publish_step_${step.status}`,
        data: {
          step: step.step,
          attemptId: attempt.id,
          marketplace: "ebay",
          environment,
          ...bulkRunMetadata(input.bulkRunId),
        } as Prisma.InputJsonValue,
      })),
      {
        kind: "ebay_inventory_item_created",
        data: {
          sku: result.sku,
          attemptId: attempt.id,
          ...bulkRunMetadata(input.bulkRunId),
        },
      },
      {
        kind: "ebay_offer_created",
        data: {
          offerId: result.offerId,
          sku: result.sku,
          attemptId: attempt.id,
          ...bulkRunMetadata(input.bulkRunId),
        },
      },
      {
        kind: "ebay_offer_published",
        data: {
          listingId: result.listingId,
          offerId: result.offerId,
          attemptId: attempt.id,
          ...bulkRunMetadata(input.bulkRunId),
        },
      },
    ];
    for (const step of steps) {
      await prisma.marketplaceEvent.create({
        data: { marketplaceListingId: listing.id, kind: step.kind, data: step.data },
      });
    }

    if (prisma.marketplaceListing.update) {
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: {
          status: "LISTED",
          sku: result.sku,
          externalOfferId: result.offerId,
          externalListingId: result.listingId,
          lastSyncAt: new Date(),
          lastError: null,
        },
      });
    }
    if (prisma.inventoryItem.update) {
      await syncMasterStatusAfterMarketplacePublish(
        {
          inventoryItem: {
            update: prisma.inventoryItem.update.bind(prisma.inventoryItem),
          },
        },
        input.inventoryItemId,
      );
    }

    return {
      ok: true,
      httpStatus: 200,
      outcome: result,
      marketplaceListingId: listing.id,
      publishAttemptId: attempt.id,
      sku: result.sku,
      offerId: result.offerId,
      listingId: result.listingId,
    };
  });
}

async function executeStockXPublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  listing: {
    id: string;
    status?: string;
    externalListingId?: string | null;
    publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
  },
  stockxPublish: StockXPublishFn,
): Promise<ExecutePublishResult> {
  assertStockXPublishNotDuplicate(listing);

  const idempotencyKey = `${input.inventoryItemId}:stockx:${STOCKX_ENVIRONMENT}`;
  const startedAt = new Date();
  let attempt: { id: string };
  try {
    attempt = await withMigrationDetection(async () => {
      const created = await prisma.publishAttempt.create({
        data: {
          marketplaceListingId: listing.id,
          status: "RUNNING",
          idempotencyKey,
          code: stockxErrorCodes.listingStarted,
          reason: null,
          adapterResult: (input.bulkRunId === undefined
            ? null
            : { bulkRunId: input.bulkRunId }) as unknown as Prisma.InputJsonValue,
          requestedBy: input.userId,
          completedAt: null,
        },
      });
      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "publish_started",
          data: {
            attemptId: created.id,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
            idempotencyKey,
            startedAt: startedAt.toISOString(),
            ...bulkRunMetadata(input.bulkRunId),
          },
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new StockXIntegrationError(
        stockxErrorCodes.alreadyPublished,
        "This item already has an in-flight or completed StockX publish attempt. Refusing to create a duplicate listing.",
        409,
        { marketplaceListingId: listing.id, idempotencyKey },
      );
    }
    throw error;
  }

  let result: StockXPublishResult;
  try {
    result = await stockxPublish(prisma as unknown as StockXPublishPrismaLike, {
      userId: input.userId,
      accountId: input.accountId,
      inventoryItemId: input.inventoryItemId,
      confirmLivePublish: input.confirmLivePublish,
    });
  } catch (error) {
    await recordStockXFailure(prisma, listing.id, attempt.id, error, input.bulkRunId);
    throw error;
  }

  if (result.status === "not_enabled") {
    return withMigrationDetection(async () => {
      await updatePublishAttempt(prisma, attempt.id, {
        status: "NOT_IMPLEMENTED",
        code: result.code,
        reason: result.message,
        adapterResult: {
          ...result,
          ...bulkRunMetadata(input.bulkRunId),
        } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      });

      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId: listing.id,
          kind: "publish_blocked",
          data: {
            code: result.code,
            attemptId: attempt.id,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
            ...bulkRunMetadata(input.bulkRunId),
          },
        },
      });

      return {
        ok: true,
        httpStatus: 503,
        outcome: result,
        marketplaceListingId: listing.id,
        publishAttemptId: attempt.id,
      };
    });
  }

  const listed = result.status === "published";
  return withMigrationDetection(async () => {
    await updatePublishAttempt(prisma, attempt.id, {
      status: listed ? "SUCCEEDED" : "RUNNING",
      code: result.code,
      reason: listed ? null : "StockX accepted the listing operation and is still processing it.",
      adapterResult: {
        ...result,
        ...bulkRunMetadata(input.bulkRunId),
      } as unknown as Prisma.InputJsonValue,
      completedAt: listed ? new Date() : null,
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: listed ? "stockx_listing_published" : "stockx_listing_submitted",
        data: {
          code: result.code,
          attemptId: attempt.id,
          marketplace: "stockx",
          environment: STOCKX_ENVIRONMENT,
          listingId: result.listingId,
          operationId: result.operationId,
          operationStatus: result.operationStatus,
          ...bulkRunMetadata(input.bulkRunId),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (prisma.marketplaceListing.update) {
      await prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: {
          status: listed ? "LISTED" : "LISTING",
          externalListingId: result.listingId,
          externalUrl: result.listingUrl,
          metadata: {
            operationId: result.operationId,
            operationStatus: result.operationStatus,
            operationUrl: result.operationUrl,
          },
          lastSyncAt: new Date(),
          lastError: null,
        },
      });
    }

    if (listed && prisma.inventoryItem.update) {
      await syncMasterStatusAfterMarketplacePublish(
        {
          inventoryItem: {
            update: prisma.inventoryItem.update.bind(prisma.inventoryItem),
          },
        },
        input.inventoryItemId,
      );
    }

    return {
      ok: true,
      httpStatus: listed ? 200 : 202,
      outcome: result,
      marketplaceListingId: listing.id,
      publishAttemptId: attempt.id,
      listingId: result.listingId,
    };
  });
}

function assertEbayPublishNotDuplicate(listing: {
  id: string;
  status?: string;
  sku?: string | null;
  externalOfferId?: string | null;
  externalListingId?: string | null;
  publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
}) {
  // Only an actual publish attempt (code EBAY_PUBLISH_*) blocks a re-publish.
  // Orphan-cleanup and delist attempts share the PublishAttempt table and can be
  // SUCCEEDED without a live listing existing; counting them here would leave an
  // item permanently un-publishable after a cleanup.
  const blockedAttempt = listing.publishAttempts?.find(
    (attempt) =>
      typeof attempt.code === "string" &&
      attempt.code.startsWith("EBAY_PUBLISH") &&
      ["QUEUED", "RUNNING", "SUCCEEDED"].includes(attempt.status),
  );
  if (blockedAttempt) {
    throw new EbayIntegrationError(
      ebayErrorCodes.alreadyPublished,
      `This item already has an eBay publish attempt with status ${blockedAttempt.status}. Refusing to create a duplicate listing.`,
      409,
      {
        marketplaceListingId: listing.id,
        blockingAttemptStatus: blockedAttempt.status,
      },
    );
  }

  if (!listing.externalListingId && !listing.externalOfferId && listing.status !== "LISTED") {
    return;
  }

  throw new EbayIntegrationError(
    ebayErrorCodes.alreadyPublished,
    listing.externalListingId
      ? "This item already has an eBay listing. Revise/relist is not implemented yet."
      : "This item already has an eBay offer. Refusing to create a duplicate offer.",
    409,
    {
      marketplaceListingId: listing.id,
      hasExternalListingId: Boolean(listing.externalListingId),
      hasExternalOfferId: Boolean(listing.externalOfferId),
      hasSku: Boolean(listing.sku),
    },
  );
}

function assertStockXPublishNotDuplicate(listing: {
  id: string;
  status?: string;
  externalListingId?: string | null;
  publishAttempts?: Array<{ status: PublishAttemptStatus | string; code?: string }>;
}) {
  const blockedAttempt = listing.publishAttempts?.find(
    (attempt) =>
      typeof attempt.code === "string" &&
      attempt.code.startsWith("STOCKX_LISTING") &&
      ["QUEUED", "RUNNING", "SUCCEEDED"].includes(attempt.status),
  );
  if (blockedAttempt) {
    throw new StockXIntegrationError(
      stockxErrorCodes.alreadyPublished,
      `This item already has a StockX publish attempt with status ${blockedAttempt.status}. Refusing to create a duplicate listing.`,
      409,
      {
        marketplaceListingId: listing.id,
        blockingAttemptStatus: blockedAttempt.status,
      },
    );
  }

  if (
    !listing.externalListingId &&
    listing.status !== "LISTED" &&
    listing.status !== "LISTING"
  ) {
    return;
  }

  throw new StockXIntegrationError(
    stockxErrorCodes.alreadyPublished,
    "This item already has a StockX listing or listing operation. Refusing to create a duplicate listing.",
    409,
    {
      marketplaceListingId: listing.id,
      hasExternalListingId: Boolean(listing.externalListingId),
      listingStatus: listing.status,
    },
  );
}

async function recordStockXFailure(
  prisma: PublishPrismaLike,
  marketplaceListingId: string,
  publishAttemptId: string,
  error: unknown,
  bulkRunId?: string,
): Promise<void> {
  const code =
    error instanceof StockXIntegrationError
      ? error.code
      : stockxErrorCodes.listingFailed;
  const missing =
    error instanceof StockXIntegrationError &&
    Array.isArray(error.details?.missing)
      ? error.details.missing.filter((id): id is string => typeof id === "string")
      : [];
  const reason = safePersistedFailureReason(error, "StockX listing failed.");

  await withMigrationDetection(async () => {
    await updatePublishAttempt(prisma, publishAttemptId, {
      status: "FAILED",
      code,
      reason,
      adapterResult: {
        code,
        missing,
        ...bulkRunMetadata(bulkRunId),
      } as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId,
        kind: "publish_failed",
        data: {
          code,
          missing,
          attemptId: publishAttemptId,
          marketplace: "stockx",
          environment: STOCKX_ENVIRONMENT,
          ...bulkRunMetadata(bulkRunId),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { id: publishAttemptId };
  });
}

async function recordEbayFailure(
  prisma: PublishPrismaLike,
  marketplaceListingId: string,
  publishAttemptId: string,
  error: unknown,
  bulkRunId?: string,
): Promise<void> {
  const code =
    error instanceof EbayIntegrationError ? error.code : "EBAY_PUBLISH_FAILED";
  const missing =
    error instanceof EbayIntegrationError &&
    Array.isArray(error.details?.missing)
      ? error.details.missing.filter((id): id is string => typeof id === "string")
      : [];
  const safeReason = safePersistedFailureReason(error, "eBay publish failed.");
  const reason =
    missing.length > 0 ? `${safeReason} Missing: ${missing.join(", ")}.` : safeReason;
  const step =
    error instanceof EbayIntegrationError &&
    error.details &&
    typeof error.details.step === "string"
      ? error.details.step
      : null;
  const ebayError =
    error instanceof EbayIntegrationError &&
    error.details &&
    isRecord(error.details.ebayError)
      ? safeEbayErrorRecord(error.details.ebayError)
      : null;
  const stepEvents =
    error instanceof EbayIntegrationError && Array.isArray(error.details?.stepEvents)
      ? error.details.stepEvents.filter(isPublishStepEvent)
      : [];
  const startedSteps =
    error instanceof EbayIntegrationError && Array.isArray(error.details?.startedSteps)
      ? error.details.startedSteps.filter((value): value is string => typeof value === "string")
      : [];
  const succeededSteps =
    error instanceof EbayIntegrationError && Array.isArray(error.details?.succeededSteps)
      ? error.details.succeededSteps.filter((value): value is string => typeof value === "string")
      : [];

  await withMigrationDetection(async () => {
    await updatePublishAttempt(prisma, publishAttemptId, {
      status: "FAILED",
      code,
      reason,
      adapterResult: {
        code,
        step,
        missing,
        ebayError,
        stepEvents,
        startedSteps,
        succeededSteps,
        ...bulkRunMetadata(bulkRunId),
      } as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    });

    for (const stepEvent of stepEvents) {
      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId,
          kind: `ebay_publish_step_${stepEvent.status}`,
          data: {
            code,
            step: stepEvent.step,
            attemptId: publishAttemptId,
            marketplace: "ebay",
            ...bulkRunMetadata(bulkRunId),
          },
        },
      });
    }

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId,
        kind: "publish_failed",
        data: {
          code,
          step,
          missing,
          ebayError,
          startedSteps,
          succeededSteps,
          attemptId: publishAttemptId,
          marketplace: "ebay",
          ...bulkRunMetadata(bulkRunId),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { id: publishAttemptId };
  });
}

function bulkRunMetadata(bulkRunId: string | undefined): { bulkRunId?: string } {
  return bulkRunId === undefined ? {} : { bulkRunId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Persist only safe fields of an eBay error object: the numeric HTTP status and a
// scrubbed message. Drops any raw body/headers/payload so the debug panel
// (ebayErrorStatus / ebayErrorMessage) can never render raw provider text.
function safeEbayErrorRecord(value: Record<string, unknown>): {
  status?: number;
  message: string;
} {
  const status = typeof value.status === "number" ? value.status : undefined;
  const message = safeFailureText(
    typeof value.message === "string" ? value.message : null,
    "eBay returned an error.",
  );
  return { ...(status !== undefined ? { status } : {}), message };
}

function isPublishStepEvent(value: unknown): value is EbayPublishStepRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.step === "string" &&
    ["inventory_item", "offer", "publish"].includes(value.step) &&
    typeof value.status === "string" &&
    ["started", "succeeded", "failed"].includes(value.status)
  );
}

async function updatePublishAttempt(
  prisma: PublishPrismaLike,
  id: string,
  data: {
    status: PublishAttemptStatus;
    code: string;
    reason: string | null;
    adapterResult: Prisma.InputJsonValue;
    completedAt: Date | null;
  },
) {
  if (prisma.publishAttempt.update) {
    return prisma.publishAttempt.update({ where: { id }, data });
  }
  return { id };
}

async function withMigrationDetection<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PublishingMigrationMissingError) {
      throw error;
    }
    if (isMissingPublishingPersistenceError(error)) {
      throw new PublishingMigrationMissingError();
    }
    throw error;
  }
}

function assertPublishingPersistenceDelegates(
  prisma: PublishPrismaLike,
): asserts prisma is PublishPrismaLike {
  if (
    typeof prisma.publishAttempt?.create !== "function" ||
    typeof prisma.marketplaceEvent?.create !== "function"
  ) {
    throw new PublishingMigrationMissingError();
  }
}

// Prisma surfaces a unique-constraint breach as P2002; the raw Postgres code is
// 23505. Either reaching us from the active-attempt insert means the partial
// unique index rejected a duplicate active publish/delist.
export function isUniqueConstraintViolation(error: unknown): boolean {
  const code = getNestedErrorCode(error);
  return code === "P2002" || code === "23505";
}

function isMissingPublishingPersistenceError(error: unknown) {
  const code = getNestedErrorCode(error);
  const message = getNestedErrorMessage(error);

  if (code === "P2021" || code === "42P01") {
    return mentionsPublishingPersistence(message);
  }

  return (
    /relation .* does not exist/i.test(message) &&
    mentionsPublishingPersistence(message)
  );
}

function mentionsPublishingPersistence(message: string) {
  return publishingPersistenceTables.some((table) => message.includes(table));
}

function getNestedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "string") {
    return maybeCode;
  }

  return getNestedErrorCode((error as { cause?: unknown }).cause);
}

function getNestedErrorMessage(error: unknown): string {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    const nested = getNestedErrorMessage(error.cause);
    return `${error.message} ${nested}`.trim();
  }

  if (typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    const nested = getNestedErrorMessage((error as { cause?: unknown }).cause);

    return `${typeof maybeMessage === "string" ? maybeMessage : ""} ${nested}`.trim();
  }

  return String(error);
}
