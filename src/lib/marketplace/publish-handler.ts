import type { InventoryStatus, Prisma } from "@/generated/prisma/client";
import type { Marketplace } from "@/lib/ai/listing-draft";
import { AppError } from "@/lib/errors";
import { canPublish, toLifecycleState } from "@/lib/lifecycle/item-status";

import { getMarketplaceAdapter, type PublishOutcome } from "./adapter";

const publishingPersistenceTables = ["PublishAttempt", "MarketplaceEvent"] as const;

export const publishingMigrationMissingCode = "PUBLISHING_MIGRATION_MISSING";

export class PublishingMigrationMissingError extends AppError {
  readonly missingTables = publishingPersistenceTables;

  constructor() {
    super(
      "Publishing persistence is not ready yet. Apply the migration that creates PublishAttempt and MarketplaceEvent, then retry. Nothing was published.",
      503,
      publishingMigrationMissingCode,
    );
    this.name = "PublishingMigrationMissingError";
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      missingTables: [...this.missingTables],
    };
  }
}

// Structural subset of the Prisma client this handler needs. Keeping it
// narrow lets the unit tests use a tiny in-memory fake without dragging in
// the full client surface.
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
  };
  publishAttempt: {
    create(args: {
      data: {
        marketplaceListingId: string;
        status: "NOT_IMPLEMENTED";
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
  httpStatus: 501;
  outcome: PublishOutcome;
  marketplaceListingId: string;
  publishAttemptId: string;
};

type AdapterResolver = (marketplace: Marketplace) => {
  publishDraft(args: { inventoryItemId: string }): Promise<PublishOutcome>;
};

// Persists a single publish attempt for an approved item and returns the
// honest NOT_IMPLEMENTED outcome. Throws typed AppError for 404/409 so the
// thin route handler can map them uniformly.
export async function executePublish(
  prisma: PublishPrismaLike,
  input: ExecutePublishInput,
  resolveAdapter: AdapterResolver = getMarketplaceAdapter,
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

  const outcome = await resolveAdapter(input.marketplace).publishDraft({
    inventoryItemId: item.id,
  });
  const completedAt = new Date();

  try {
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
  } catch (error) {
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
