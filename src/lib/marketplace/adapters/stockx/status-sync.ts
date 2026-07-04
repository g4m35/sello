import type {
  MarketplaceListingStatus,
  Prisma,
} from "@/generated/prisma/client";
import { markItemSold, type MarkSoldPrismaLike } from "@/lib/inventory/mark-sold";

import { fetchStockXListingStatus } from "./client";
import { getStockXApiConfig, isStockXApiConfigured } from "./config";
import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import { decryptStockXToken } from "./token-crypto";
import {
  STOCKX_ENVIRONMENT,
  type StockXConfig,
  type StockXListingStatusResult,
} from "./types";

type StockXEnv = Record<string, string | undefined>;

type ConnectionRow = {
  id: string;
  accountId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
};

type ListingRow = {
  id: string;
  inventoryItemId: string;
  marketplace: "stockx";
  status: MarketplaceListingStatus;
  externalListingId: string | null;
  metadata: Prisma.JsonValue | null;
  inventoryItem: {
    accountId: string | null;
    sellerId: string;
  };
};

export type StockXStatusSyncPrismaLike = MarkSoldPrismaLike & {
  marketplaceListing: MarkSoldPrismaLike["marketplaceListing"] & {
    findFirst(args: {
      where: {
        id: string;
        marketplace: "stockx";
        inventoryItem: { sellerId: string };
      };
      select: unknown;
    }): Promise<ListingRow | null>;
    update(args: {
      where: { id: string };
      data: {
        status?: MarketplaceListingStatus;
        metadata?: Prisma.InputJsonValue;
        lastSyncAt?: Date;
        lastError?: string | null;
        endedAt?: Date;
      };
    }): Promise<{ id: string }>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        accountId_marketplace_environment?: {
          accountId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
        userId_marketplace_environment?: {
          userId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
      };
      select?: unknown;
    }): Promise<ConnectionRow | null>;
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
  publishAttempt?: {
    updateMany(args: {
      where: {
        marketplaceListingId: string;
        status: "RUNNING";
        code?: { in: string[] };
      };
      data: {
        status: "SUCCEEDED";
        code: string;
        reason: string | null;
        completedAt: Date;
        adapterResult?: Prisma.InputJsonValue;
      };
    }): Promise<{ count: number }>;
  };
};

export type StockXListingStatusClient = {
  fetchListingStatus(listingId: string): Promise<StockXListingStatusResult>;
};

export type StockXStatusSyncDeps = {
  env: StockXEnv;
  resolveAccessToken: (
    connection: ConnectionRow,
    config: StockXConfig,
  ) => Promise<string> | string;
  createClient: (
    accessToken: string,
    config: StockXConfig,
  ) => StockXListingStatusClient;
  markSold: typeof markItemSold;
};

export type StockXStatusSyncInput = {
  userId: string;
  accountId?: string;
  inventoryItemId?: string | null;
  marketplaceListingId: string;
};

export type StockXStatusSyncResult = {
  status: "active" | "sold" | "ended" | "unknown";
  code: string;
  marketplace: "stockx";
  environment: typeof STOCKX_ENVIRONMENT;
  listingId: string;
  remoteStatus: string | null;
  operationStatus: string | null;
};

export const defaultStockXStatusSyncDeps: StockXStatusSyncDeps = {
  env: process.env,
  resolveAccessToken: (connection, config) =>
    decryptStockXToken(connection.accessTokenEnc, config.tokenEncryptionKey),
  createClient: (accessToken, config) => ({
    fetchListingStatus: (listingId) =>
      fetchStockXListingStatus(config, accessToken, listingId),
  }),
  markSold: markItemSold,
};

export async function syncStockXListingStatus(
  prisma: StockXStatusSyncPrismaLike,
  input: StockXStatusSyncInput,
  deps: StockXStatusSyncDeps = defaultStockXStatusSyncDeps,
): Promise<StockXStatusSyncResult> {
  if (!isStockXApiConfigured(deps.env)) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      "StockX API is not configured.",
      503,
    );
  }
  const config = getStockXApiConfig(deps.env);

  const listing = await prisma.marketplaceListing.findFirst({
    where: {
      id: input.marketplaceListingId,
      marketplace: "stockx",
      inventoryItem: { sellerId: input.userId },
    },
    select: {
      id: true,
      inventoryItemId: true,
      marketplace: true,
      status: true,
      externalListingId: true,
      metadata: true,
      inventoryItem: { select: { accountId: true, sellerId: true } },
    },
  });

  if (!listing) {
    throw new StockXIntegrationError(
      stockxErrorCodes.apiFailed,
      "StockX listing was not found.",
      404,
    );
  }
  if (!listing.externalListingId) {
    throw new StockXIntegrationError(
      stockxErrorCodes.listingReadinessFailed,
      "No StockX listing id is stored for this item.",
      422,
    );
  }

  const accountId = input.accountId ?? listing.inventoryItem.accountId ?? undefined;
  const connection = await prisma.marketplaceConnection.findUnique({
    where: accountId
      ? {
          accountId_marketplace_environment: {
            accountId,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
          },
        }
      : {
          userId_marketplace_environment: {
            userId: input.userId,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
          },
        },
    select: {
      id: true,
      accountId: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
    },
  });

  if (!connection) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConnected,
      "Connect StockX before syncing StockX listing status.",
      422,
    );
  }

  const accessToken = await deps.resolveAccessToken(connection, config);
  const remote = await deps
    .createClient(accessToken, config)
    .fetchListingStatus(listing.externalListingId);
  const remoteStatus = remote.status;
  const operationStatus = remote.operationStatus;
  const classification = classifyStockXStatus(remote);
  const now = new Date();
  const metadata = stockxStatusMetadata(listing.metadata, remote, classification);

  if (classification === "sold") {
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "SOLD",
        metadata,
        lastSyncAt: now,
        lastError: null,
      },
    });
    await deps.markSold(prisma, {
      inventoryItemId: listing.inventoryItemId,
      userId: input.userId,
      soldMarketplace: "stockx",
      soldListingId: listing.externalListingId,
      source: "api",
    });
    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "stockx_listing_sold",
        data: statusEventData(remote, classification),
      },
    });
  } else if (classification === "active") {
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "LISTED",
        metadata,
        lastSyncAt: now,
        lastError: null,
      },
    });
    await prisma.publishAttempt?.updateMany({
      where: {
        marketplaceListingId: listing.id,
        status: "RUNNING",
        code: { in: [stockxErrorCodes.listingStarted, stockxErrorCodes.listingSubmitted] },
      },
      data: {
        status: "SUCCEEDED",
        code: stockxErrorCodes.listingSucceeded,
        reason: null,
        completedAt: now,
        adapterResult: statusEventData(remote, classification),
      },
    });
    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "stockx_listing_active",
        data: statusEventData(remote, classification),
      },
    });
  } else if (classification === "ended") {
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        status: "ENDED",
        metadata,
        lastSyncAt: now,
        lastError: null,
        endedAt: now,
      },
    });
    await prisma.marketplaceEvent.create({
      data: {
        marketplaceListingId: listing.id,
        kind: "stockx_listing_ended",
        data: statusEventData(remote, classification),
      },
    });
  } else {
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: {
        metadata,
        lastSyncAt: now,
        lastError: null,
      },
    });
  }

  return {
    status: classification,
    code: "STOCKX_STATUS_SYNCED",
    marketplace: "stockx",
    environment: STOCKX_ENVIRONMENT,
    listingId: remote.listingId,
    remoteStatus,
    operationStatus,
  };
}

function classifyStockXStatus(
  result: StockXListingStatusResult,
): StockXStatusSyncResult["status"] {
  const value = `${result.status ?? ""} ${result.operationStatus ?? ""}`
    .trim()
    .toUpperCase();
  if (/\b(SOLD|SALE|FULFILLED|COMPLETE|COMPLETED)\b/.test(value)) return "sold";
  if (/\b(ACTIVE|ACTIVATED|LISTED|LIVE|SUCCEEDED|SUCCESS)\b/.test(value)) {
    return "active";
  }
  if (/\b(INACTIVE|DEACTIVATED|ENDED|REMOVED|CANCELED|CANCELLED|EXPIRED)\b/.test(value)) {
    return "ended";
  }
  return "unknown";
}

function stockxStatusMetadata(
  existing: Prisma.JsonValue | null,
  result: StockXListingStatusResult,
  classification: StockXStatusSyncResult["status"],
): Prisma.InputJsonValue {
  const base = isRecord(existing) ? existing : {};
  return {
    ...base,
    stockxStatus: {
      listingId: result.listingId,
      status: result.status,
      operationId: result.operationId,
      operationStatus: result.operationStatus,
      operationUrl: result.operationUrl,
      classification,
      checkedAt: new Date().toISOString(),
    },
  };
}

function statusEventData(
  result: StockXListingStatusResult,
  classification: StockXStatusSyncResult["status"],
): Prisma.InputJsonValue {
  return {
    marketplace: "stockx",
    environment: STOCKX_ENVIRONMENT,
    listingId: result.listingId,
    remoteStatus: result.status,
    operationId: result.operationId,
    operationStatus: result.operationStatus,
    operationUrl: result.operationUrl,
    classification,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
