import { AppError } from "@/lib/errors";

import { EbaySandboxClient, getUsableEbayAccessToken } from "./client";
import { getEbayConfig, getEbayEnvironment } from "./config";
import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type { EbayConfig, EbayEnvironment, EbayMarketplaceId } from "./types";

type ConnectionRow = {
  id: string;
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

export type EbayDelistPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      select?: { id: true };
    }): Promise<{ id: string } | null>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        userId_marketplace_environment?: {
          userId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
        accountId_marketplace_environment?: {
          accountId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
      };
    }): Promise<ConnectionRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type EbayDelistClient = {
  withdrawOffer(offerId: string): Promise<{ listingId: string | null }>;
};

export type EbayDelistDeps = {
  env: Record<string, string | undefined>;
  resolveAccessToken: (
    prisma: EbayDelistPrismaLike,
    connection: ConnectionRow,
    config: EbayConfig,
  ) => Promise<string>;
  createClient: (
    accessToken: string,
    marketplaceId: EbayMarketplaceId,
    environment: EbayEnvironment,
  ) => EbayDelistClient;
};

export type EbayDelistInput = {
  userId: string;
  accountId?: string;
  inventoryItemId: string;
  offerId: string;
  listingId: string | null;
};

export type EbayDelistResult = {
  status: "delisted";
  code: "EBAY_DELIST_SUCCEEDED";
  marketplace: "ebay";
  environment: EbayEnvironment;
  offerId: string;
  listingId: string | null;
};

export const defaultEbayDelistDeps: EbayDelistDeps = {
  env: process.env,
  resolveAccessToken: (prisma, connection, config) =>
    getUsableEbayAccessToken(prisma, connection, config),
  createClient: (accessToken, marketplaceId, environment) =>
    new EbaySandboxClient(accessToken, marketplaceId, fetch, environment),
};

export async function delistEbayListing(
  prisma: EbayDelistPrismaLike,
  input: EbayDelistInput,
  deps: EbayDelistDeps = defaultEbayDelistDeps,
): Promise<EbayDelistResult> {
  const environment = getEbayEnvironment(deps.env);
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
            marketplace: "ebay",
            environment,
          },
        }
      : {
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
      `Connect eBay ${environment} before ending this listing.`,
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
  const result = await client.withdrawOffer(input.offerId);

  return {
    status: "delisted",
    code: "EBAY_DELIST_SUCCEEDED",
    marketplace: "ebay",
    environment,
    offerId: input.offerId,
    listingId: result.listingId ?? input.listingId,
  };
}
