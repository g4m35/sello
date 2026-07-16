import { AppError } from "@/lib/errors";

import { deactivateStockXListing, deleteStockXListing } from "./client";
import { getStockXApiConfig, isStockXApiConfigured } from "./config";
import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import { decryptStockXToken } from "./token-crypto";
import {
  STOCKX_ENVIRONMENT,
  type StockXConfig,
  type StockXDeactivateListingResult,
} from "./types";

type StockXEnv = Record<string, string | undefined>;

type ConnectionRow = {
  id: string;
  accountId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
};

export type StockXDelistPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select?: unknown;
    }): Promise<{ id: string } | null>;
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
};

export type StockXDelistClient = {
  deactivateListing(listingId: string): Promise<StockXDeactivateListingResult>;
  deleteListing(listingId: string): Promise<StockXDeactivateListingResult>;
};

export type StockXDelistDeps = {
  env: StockXEnv;
  resolveAccessToken: (
    connection: ConnectionRow,
    config: StockXConfig,
  ) => Promise<string> | string;
  createClient: (
    accessToken: string,
    config: StockXConfig,
  ) => StockXDelistClient;
};

export type StockXDelistInput = {
  userId: string;
  accountId?: string;
  inventoryItemId: string;
  listingId: string;
};

export type StockXDelistResult = {
  status: "delisted";
  code: typeof stockxErrorCodes.delistSucceeded;
  marketplace: "stockx";
  environment: typeof STOCKX_ENVIRONMENT;
  listingId: string;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
};

export const defaultStockXDelistDeps: StockXDelistDeps = {
  env: process.env,
  resolveAccessToken: (connection, config) =>
    decryptStockXToken(connection.accessTokenEnc, config.tokenEncryptionKey),
  createClient: (accessToken, config) => ({
    deactivateListing: (listingId) =>
      deactivateStockXListing(config, accessToken, listingId),
    deleteListing: (listingId) =>
      deleteStockXListing(config, accessToken, listingId),
  }),
};

export async function delistStockXListing(
  prisma: StockXDelistPrismaLike,
  input: StockXDelistInput,
  deps: StockXDelistDeps = defaultStockXDelistDeps,
): Promise<StockXDelistResult> {
  if (!isStockXApiConfigured(deps.env)) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      "StockX API is not configured.",
      503,
    );
  }
  const config = getStockXApiConfig(deps.env);

  const item = await prisma.inventoryItem.findFirst({
    where: input.accountId
      ? { id: input.inventoryItemId, accountId: input.accountId }
      : { id: input.inventoryItemId, sellerId: input.userId },
    select: { id: true },
  });
  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const connection = await prisma.marketplaceConnection.findUnique({
    where: input.accountId
      ? {
          accountId_marketplace_environment: {
            accountId: input.accountId,
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
      "Connect StockX before ending a StockX listing.",
      422,
    );
  }

  const accessToken = await deps.resolveAccessToken(connection, config);
  const client = deps.createClient(accessToken, config);
  const result = await deactivateOrDeleteStockXListing(client, input.listingId);

  return {
    status: "delisted",
    code: stockxErrorCodes.delistSucceeded,
    marketplace: "stockx",
    environment: STOCKX_ENVIRONMENT,
    listingId: result.listingId || input.listingId,
    operationId: result.operationId,
    operationStatus: result.operationStatus,
    operationUrl: result.operationUrl,
  };
}

async function deactivateOrDeleteStockXListing(
  client: StockXDelistClient,
  listingId: string,
): Promise<StockXDeactivateListingResult> {
  try {
    return await client.deactivateListing(listingId);
  } catch (error) {
    if (
      error instanceof StockXIntegrationError &&
      error.details?.status === 400
    ) {
      return client.deleteListing(listingId);
    }
    throw error;
  }
}
