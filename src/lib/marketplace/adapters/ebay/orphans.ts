import type {
  InventoryStatus,
  ItemCondition,
  Prisma,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { syncMasterStatusAfterMarketplaceCleanup } from "@/lib/marketplace/lifecycle-sync";

import { EbaySandboxClient, getUsableEbayAccessToken } from "./client";
import { getEbayConfig, getEbayEnvironment } from "./config";
import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import { resolveEbaySku } from "./mapper";
import type {
  EbayConfig,
  EbayEnvironment,
  EbayInventoryItemLookup,
  EbayMarketplaceId,
  EbayOfferLookup,
} from "./types";

type ConnectionRow = {
  id: string;
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

type ItemRow = {
  id: string;
  sellerId: string;
  brand: string | null;
  condition: ItemCondition;
  size: string | null;
  colorway: string | null;
  listingDrafts?: Array<{ title: string | null }>;
};

type MarketplaceListingRow = {
  id: string;
  status: string;
  sku: string | null;
  externalOfferId: string | null;
  externalListingId: string | null;
  publishAttempts: Array<{ status: PublishAttemptStatus | string; code: string }>;
};

export type EbayOrphanPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; sellerId: string };
      include?: unknown;
      select?: unknown;
    }): Promise<ItemRow | null>;
    update(args: {
      where: { id: string };
      data: { status: InventoryStatus };
    }): Promise<unknown>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        userId_marketplace_environment: {
          userId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
      };
    }): Promise<ConnectionRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  marketplaceListing: {
    findFirst(args: {
      where: { inventoryItemId: string; marketplace: "ebay"; environment: string };
      select?: unknown;
    }): Promise<MarketplaceListingRow | null>;
    upsert(args: {
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: string;
          marketplace: "ebay";
          environment: string;
        };
      };
      create: {
        inventoryItemId: string;
        marketplace: "ebay";
        environment: string;
        status: "NOT_LISTED";
        sku?: string;
      };
      update: Record<string, unknown>;
      select?: unknown;
    }): Promise<MarketplaceListingRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
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

export type EbayOrphanClient = {
  getInventoryItem(sku: string): Promise<EbayInventoryItemLookup | null>;
  getOffersBySku(sku: string): Promise<EbayOfferLookup[]>;
  deleteOffer(offerId: string): Promise<void>;
  deleteInventoryItem(sku: string): Promise<void>;
};

export type EbayOrphanDeps = {
  env: Record<string, string | undefined>;
  resolveAccessToken: (
    prisma: EbayOrphanPrismaLike,
    connection: ConnectionRow,
    config: EbayConfig,
  ) => Promise<string>;
  createClient: (
    accessToken: string,
    marketplaceId: EbayMarketplaceId,
    environment: EbayEnvironment,
  ) => EbayOrphanClient;
};

export type EbayOrphanScanResult = {
  sku: string;
  inventoryItemFound: boolean;
  offers: Array<{
    offerId: string | null;
    status: string | null;
    listingId: string | null;
    listingStatus: string | null;
  }>;
  liveListingFound: boolean;
  cleanupAvailable: boolean;
  checkedAt: string;
};

export type EbayOrphanInput = {
  userId: string;
  inventoryItemId: string;
};

export const defaultEbayOrphanDeps: EbayOrphanDeps = {
  env: process.env,
  resolveAccessToken: (prisma, connection, config) =>
    getUsableEbayAccessToken(prisma, connection, config),
  createClient: (accessToken, marketplaceId, environment) =>
    new EbaySandboxClient(accessToken, marketplaceId, fetch, environment),
};

export async function scanEbayOrphanArtifacts(
  prisma: EbayOrphanPrismaLike,
  input: EbayOrphanInput,
  deps: EbayOrphanDeps = defaultEbayOrphanDeps,
): Promise<EbayOrphanScanResult> {
  const { item, listing, client } = await loadOrphanContext(prisma, input, deps);
  const sku = listing?.sku || resolveEbaySku({ ...item, sku: null });
  const [inventoryItem, offers] = await Promise.all([
    client.getInventoryItem(sku),
    client.getOffersBySku(sku),
  ]);
  const normalizedOffers = offers.map(normalizeOffer);
  const liveListingFound = normalizedOffers.some(isLiveOffer);
  const cleanupAvailable =
    !liveListingFound && (Boolean(inventoryItem) || normalizedOffers.length > 0);
  return {
    sku,
    inventoryItemFound: Boolean(inventoryItem),
    offers: normalizedOffers,
    liveListingFound,
    cleanupAvailable,
    checkedAt: new Date().toISOString(),
  };
}

export async function cleanupEbayOrphanArtifacts(
  prisma: EbayOrphanPrismaLike,
  input: EbayOrphanInput & { confirmCleanup: boolean },
  deps: EbayOrphanDeps = defaultEbayOrphanDeps,
) {
  if (!input.confirmCleanup) {
    throw new AppError(
      "Confirm cleanup before removing unpublished eBay artifacts.",
      400,
    );
  }

  const context = await loadOrphanContext(prisma, input, deps);
  const listing = await ensureMarketplaceListing(prisma, input, context);
  const scan = await scanEbayOrphanArtifacts(prisma, input, deps);
  if (!scan.cleanupAvailable) {
    throw new EbayIntegrationError(
      ebayErrorCodes.orphanCleanupFailed,
      scan.liveListingFound
        ? "A live eBay listing may exist. Use the live End eBay listing flow or inspect Seller Hub before cleanup."
        : "No unpublished eBay publish artifacts were found for this SKU.",
      409,
      { sku: scan.sku, liveListingFound: scan.liveListingFound },
    );
  }

  const duplicate = listing.publishAttempts.find(
    (attempt) =>
      attempt.code.startsWith("EBAY_ORPHAN_CLEANUP") &&
      ["QUEUED", "RUNNING"].includes(attempt.status),
  );
  if (duplicate) {
    throw new EbayIntegrationError(
      ebayErrorCodes.orphanCleanupFailed,
      "An eBay orphan cleanup is already running for this item.",
      409,
      { blockingAttemptStatus: duplicate.status },
    );
  }

  const idempotencyKey = `${input.inventoryItemId}:ebay:${context.environment}:orphan-cleanup`;
  const attempt = await prisma.publishAttempt.create({
    data: {
      marketplaceListingId: listing.id,
      status: "RUNNING",
      idempotencyKey,
      code: "EBAY_ORPHAN_CLEANUP_STARTED",
      reason: null,
      adapterResult: { scan } as unknown as Prisma.InputJsonValue,
      requestedBy: input.userId,
      completedAt: null,
    },
  });
  await prisma.marketplaceEvent.create({
    data: {
      marketplaceListingId: listing.id,
      kind: "ebay_orphan_cleanup_started",
      data: { attemptId: attempt.id, marketplace: "ebay", sku: scan.sku },
    },
  });

  try {
    for (const offer of scan.offers) {
      if (offer.offerId) {
        await context.client.deleteOffer(offer.offerId);
      }
    }
    if (scan.inventoryItemFound) {
      await context.client.deleteInventoryItem(scan.sku);
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "eBay orphan cleanup failed.";
    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        code: ebayErrorCodes.orphanCleanupFailed,
        reason,
        adapterResult: { scan, error: errorDetails(error) } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "ebay_orphan_cleanup_failed",
        data: {
          attemptId: attempt.id,
          marketplace: "ebay",
          sku: scan.sku,
          error: errorDetails(error),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { lastError: reason },
    });
    throw error;
  }

  await prisma.publishAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "SUCCEEDED",
      code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED",
      reason: null,
      adapterResult: { scan } as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  await prisma.marketplaceEvent.create({
    data: {
      marketplaceListingId: listing.id,
      kind: "ebay_orphan_cleanup_succeeded",
      data: { attemptId: attempt.id, marketplace: "ebay", sku: scan.sku },
    },
  });
  await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: {
      sku: scan.sku,
      externalOfferId: null,
      externalListingId: null,
      lastError: null,
    },
  });
  await syncMasterStatusAfterMarketplaceCleanup(prisma, input.inventoryItemId);

  return {
    ok: true as const,
    status: "cleaned" as const,
    code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED",
    marketplace: "ebay" as const,
    environment: context.environment,
    scan,
    marketplaceListingId: listing.id,
    publishAttemptId: attempt.id,
  };
}

async function loadOrphanContext(
  prisma: EbayOrphanPrismaLike,
  input: EbayOrphanInput,
  deps: EbayOrphanDeps,
) {
  const environment = getEbayEnvironment(deps.env);
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: input.userId },
    include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      userId_marketplace_environment: {
        userId: input.userId,
        marketplace: "ebay",
        environment,
      },
    },
  });
  if (!connection) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConnected,
      `Connect eBay ${environment} before checking publish artifacts.`,
      404,
    );
  }
  const config = getEbayConfig(deps.env);
  const accessToken = await deps.resolveAccessToken(prisma, connection, config);
  const client = deps.createClient(
    accessToken,
    config.marketplaceId as EbayMarketplaceId,
    environment,
  );
  const listing = await prisma.marketplaceListing.findFirst({
    where: { inventoryItemId: item.id, marketplace: "ebay", environment },
    select: {
      id: true,
      status: true,
      sku: true,
      externalOfferId: true,
      externalListingId: true,
      publishAttempts: {
        select: { status: true, code: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  return { environment, item, listing, client };
}

async function ensureMarketplaceListing(
  prisma: EbayOrphanPrismaLike,
  input: EbayOrphanInput,
  context: Awaited<ReturnType<typeof loadOrphanContext>>,
) {
  if (context.listing) return context.listing;
  const sku = resolveEbaySku({ ...context.item, sku: null });
  return prisma.marketplaceListing.upsert({
    where: {
      inventoryItemId_marketplace_environment: {
        inventoryItemId: input.inventoryItemId,
        marketplace: "ebay",
        environment: context.environment,
      },
    },
    create: {
      inventoryItemId: input.inventoryItemId,
      marketplace: "ebay",
      environment: context.environment,
      status: "NOT_LISTED",
      sku,
    },
    update: { sku },
    select: {
      id: true,
      status: true,
      sku: true,
      externalOfferId: true,
      externalListingId: true,
      publishAttempts: {
        select: { status: true, code: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

function normalizeOffer(offer: EbayOfferLookup): EbayOrphanScanResult["offers"][number] {
  return {
    offerId: offer.offerId ?? null,
    status: offer.status ?? null,
    listingId: offer.listing?.listingId ?? null,
    listingStatus: offer.listing?.listingStatus ?? null,
  };
}

function isLiveOffer(offer: EbayOrphanScanResult["offers"][number]): boolean {
  const status = offer.status?.toUpperCase() ?? null;
  const listingStatus = offer.listingStatus?.toUpperCase() ?? null;

  return status === "PUBLISHED" || listingStatus === "ACTIVE";
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof EbayIntegrationError) {
    return error.toPayload();
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown cleanup error." };
}
