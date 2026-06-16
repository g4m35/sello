import type {
  InventoryStatus,
  Prisma,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import type { Marketplace } from "@/lib/ai/listing-draft";
import { AppError } from "@/lib/errors";
import { canPublish, toLifecycleState } from "@/lib/lifecycle/item-status";

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
// the guarded environment-specific publish flow and records the typed outcome.
// Throws typed AppError for 404/409 so the thin route handler can map them
// uniformly.
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

  const environment =
    input.marketplace === "ebay" ? getEbayEnvironment() : "manual";
  const listing = await getOrCreateMarketplaceListing(
    prisma,
    item.id,
    input.marketplace,
    environment,
  );

  if (input.marketplace === "ebay") {
    return executeEbayPublish(prisma, input, listing, environment, ebayPublish);
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
          adapterResult: null as unknown as Prisma.InputJsonValue,
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
      inventoryItemId: input.inventoryItemId,
    });
  } catch (error) {
    await recordEbayFailure(prisma, listing.id, attempt.id, error);
    throw error;
  }

  if (result.status === "not_enabled") {
    return withMigrationDetection(async () => {
      await updatePublishAttempt(prisma, attempt.id, {
        status: "NOT_IMPLEMENTED",
        code: result.code,
        reason: result.message,
        adapterResult: result as unknown as Prisma.InputJsonValue,
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
      adapterResult: result as unknown as Prisma.InputJsonValue,
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
        } as Prisma.InputJsonValue,
      })),
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

async function recordEbayFailure(
  prisma: PublishPrismaLike,
  marketplaceListingId: string,
  publishAttemptId: string,
  error: unknown,
): Promise<void> {
  const code =
    error instanceof EbayIntegrationError ? error.code : "EBAY_PUBLISH_FAILED";
  const missing =
    error instanceof EbayIntegrationError &&
    Array.isArray(error.details?.missing)
      ? error.details.missing.filter((id): id is string => typeof id === "string")
      : [];
  const reason =
    error instanceof Error
      ? missing.length > 0
        ? `${error.message} Missing: ${missing.join(", ")}.`
        : error.message
      : "eBay publish failed.";
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
      ? sanitizeJsonRecord(error.details.ebayError)
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
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { id: publishAttemptId };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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
