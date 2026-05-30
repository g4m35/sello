import type {
  InventoryStatus,
  Prisma,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import type { Marketplace } from "@/lib/ai/listing-draft";
import { AppError } from "@/lib/errors";
import { canPublish, toLifecycleState } from "@/lib/lifecycle/item-status";

import { getMarketplaceAdapter, type PublishOutcome } from "./adapter";
import { EbayIntegrationError } from "./adapters/ebay/errors";
import {
  defaultEbayPublishDeps,
  publishEbayListing,
  type EbayPublishPrismaLike,
  type EbayPublishResult,
} from "./adapters/ebay/publish";

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
      where: { id: string; sellerId: string };
      select?: { id: true; status: true };
    }): Promise<{ id: string; status: InventoryStatus } | null>;
  };
  marketplaceListing: {
    upsert(args: {
      where: {
        inventoryItemId_marketplace: {
          inventoryItemId: string;
          marketplace: Marketplace;
        };
      };
      create: {
        inventoryItemId: string;
        marketplace: Marketplace;
        status?: "NOT_LISTED";
      };
      update: Record<string, never>;
      select?: { id: true };
    }): Promise<{ id: string }>;
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
        code: string;
        reason: string | null;
        adapterResult: Prisma.InputJsonValue;
        requestedBy: string;
        completedAt: Date;
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
  inventoryItemId: string;
  marketplace: Marketplace;
};

export type ExecutePublishResult = {
  ok: true;
  httpStatus: number;
  outcome: PublishOutcome | EbayPublishResult;
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
  input: { userId: string; inventoryItemId: string },
) => Promise<EbayPublishResult>;

const defaultEbayPublish: EbayPublishFn = (prisma, input) =>
  publishEbayListing(prisma, input, defaultEbayPublishDeps);

// Persists a single publish attempt for an approved item. For non-eBay
// marketplaces it returns the honest NOT_IMPLEMENTED outcome. For eBay it runs
// the guarded sandbox publish flow (blocked unless the env flag is enabled) and
// records the typed outcome. Throws typed AppError for 404/409 so the thin
// route handler can map them uniformly.
export async function executePublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  resolveAdapter: AdapterResolver = getMarketplaceAdapter,
  ebayPublish: EbayPublishFn = defaultEbayPublish,
): Promise<ExecutePublishResult> {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: input.userId },
    select: { id: true, status: true },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  if (!canPublish(toLifecycleState(item.status))) {
    throw new AppError(
      "Publishing is blocked until the item reaches the ready state.",
      409,
    );
  }

  assertPublishingPersistenceDelegates(prisma);

  const listing = await prisma.marketplaceListing.upsert({
    where: {
      inventoryItemId_marketplace: {
        inventoryItemId: item.id,
        marketplace: input.marketplace,
      },
    },
    create: {
      inventoryItemId: item.id,
      marketplace: input.marketplace,
      status: "NOT_LISTED",
    },
    update: {},
    select: { id: true },
  });

  if (input.marketplace === "ebay") {
    return executeEbayPublish(prisma, input, listing.id, ebayPublish);
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
        adapterResult: outcome as unknown as Prisma.InputJsonValue,
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

async function executeEbayPublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  marketplaceListingId: string,
  ebayPublish: EbayPublishFn,
): Promise<ExecutePublishResult> {
  let result: EbayPublishResult;
  try {
    result = await ebayPublish(prisma as unknown as EbayPublishPrismaLike, {
      userId: input.userId,
      inventoryItemId: input.inventoryItemId,
    });
  } catch (error) {
    await recordEbayFailure(prisma, input, marketplaceListingId, error);
    throw error;
  }

  if (result.status === "not_enabled") {
    return withMigrationDetection(async () => {
      const attempt = await prisma.publishAttempt.create({
        data: {
          marketplaceListingId,
          status: "NOT_IMPLEMENTED",
          code: result.code,
          reason: result.message,
          adapterResult: result as unknown as Prisma.InputJsonValue,
          requestedBy: input.userId,
          completedAt: new Date(),
        },
      });

      await prisma.marketplaceEvent.create({
        data: {
          marketplaceListingId,
          kind: "publish_blocked",
          data: {
            code: result.code,
            attemptId: attempt.id,
            marketplace: "ebay",
          },
        },
      });

      return {
        ok: true,
        httpStatus: 200,
        outcome: result,
        marketplaceListingId,
        publishAttemptId: attempt.id,
      };
    });
  }

  // result.status === "published"
  return withMigrationDetection(async () => {
    const attempt = await prisma.publishAttempt.create({
      data: {
        marketplaceListingId,
        status: "SUCCEEDED",
        code: result.code,
        reason: null,
        adapterResult: result as unknown as Prisma.InputJsonValue,
        requestedBy: input.userId,
        completedAt: new Date(),
      },
    });

    const steps: Array<{ kind: string; data: Prisma.InputJsonValue }> = [
      {
        kind: "ebay_inventory_item_created",
        data: { sku: result.sku, attemptId: attempt.id },
      },
      {
        kind: "ebay_offer_created",
        data: { offerId: result.offerId, sku: result.sku, attemptId: attempt.id },
      },
      {
        kind: "ebay_offer_published",
        data: {
          listingId: result.listingId,
          offerId: result.offerId,
          attemptId: attempt.id,
        },
      },
    ];
    for (const step of steps) {
      await prisma.marketplaceEvent.create({
        data: { marketplaceListingId, kind: step.kind, data: step.data },
      });
    }

    if (prisma.marketplaceListing.update) {
      await prisma.marketplaceListing.update({
        where: { id: marketplaceListingId },
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

    return {
      ok: true,
      httpStatus: 200,
      outcome: result,
      marketplaceListingId,
      publishAttemptId: attempt.id,
      sku: result.sku,
      offerId: result.offerId,
      listingId: result.listingId,
    };
  });
}

async function recordEbayFailure(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  marketplaceListingId: string,
  error: unknown,
): Promise<void> {
  const code =
    error instanceof EbayIntegrationError ? error.code : "EBAY_PUBLISH_FAILED";
  const reason = error instanceof Error ? error.message : "eBay publish failed.";
  const step =
    error instanceof EbayIntegrationError &&
    error.details &&
    typeof error.details.step === "string"
      ? error.details.step
      : null;

  await withMigrationDetection(async () => {
    const attempt = await prisma.publishAttempt.create({
      data: {
        marketplaceListingId,
        status: "FAILED",
        code,
        reason,
        adapterResult: { code, step } as unknown as Prisma.InputJsonValue,
        requestedBy: input.userId,
        completedAt: new Date(),
      },
    });

    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId,
        kind: "publish_failed",
        data: { code, step, attemptId: attempt.id, marketplace: "ebay" },
      },
    });

    return attempt;
  });
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
