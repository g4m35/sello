import type { MarketplaceConnection } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import { refreshStockXAccessToken } from "./oauth";
import { decryptStockXToken, encryptStockXToken } from "./token-crypto";
import { STOCKX_ENVIRONMENT, type StockXConfig } from "./types";

type Db = ReturnType<typeof getPrisma>;

const REFRESH_BUFFER_MS = 60_000;

export type StockXConnectionSession = {
  connection: Pick<
    MarketplaceConnection,
    "id" | "accountId" | "externalUserId" | "accessTokenEnc" | "refreshTokenEnc"
  >;
  accessToken: string;
};

export async function loadStockXConnectionSession(
  prisma: Db,
  accountId: string,
  config: StockXConfig,
  options?: {
    fetchImpl?: typeof fetch;
    now?: number;
  },
): Promise<StockXConnectionSession> {
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      accountId_marketplace_environment: {
        accountId,
        marketplace: "stockx",
        environment: STOCKX_ENVIRONMENT,
      },
    },
    select: {
      id: true,
      accountId: true,
      externalUserId: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      accessTokenExpiresAt: true,
    },
  });

  if (!connection) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConnected,
      "Connect StockX before using StockX catalog tools.",
      403,
    );
  }

  const accessToken = await getUsableStockXAccessToken(prisma, connection, config, options);

  return {
    connection: {
      id: connection.id,
      accountId: connection.accountId,
      externalUserId: connection.externalUserId,
      accessTokenEnc: connection.accessTokenEnc,
      refreshTokenEnc: connection.refreshTokenEnc,
    },
    accessToken,
  };
}

export type StockXTokenConnection = Pick<MarketplaceConnection,
  "id" | "accountId" | "accessTokenEnc" | "refreshTokenEnc" | "accessTokenExpiresAt"
>;

export type StockXTokenPrismaLike = {
  marketplaceConnection: {
    update(args: {
      where: { id: string; accountId: string; accessTokenEnc: string; refreshTokenEnc: string };
      data: { accessTokenEnc: string; refreshTokenEnc: string; accessTokenExpiresAt: Date };
    }): Promise<unknown>;
  };
};

// Shared by catalog and background actions so token expiry does not strand
// listing, sale-monitoring or delisting work. Callers load a scoped connection.
export async function getUsableStockXAccessToken(
  prisma: StockXTokenPrismaLike,
  connection: StockXTokenConnection,
  config: StockXConfig,
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<string> {
  const now = options?.now ?? Date.now();
  let accessToken = decryptStockXToken(connection.accessTokenEnc, config.tokenEncryptionKey);

  if (connection.accessTokenExpiresAt.getTime() - REFRESH_BUFFER_MS <= now) {
    const refreshToken = decryptStockXToken(
      connection.refreshTokenEnc,
      config.tokenEncryptionKey,
    );
    const refreshed = await refreshStockXAccessToken(
      config,
      refreshToken,
      options?.fetchImpl ?? fetch,
    );
    accessToken = refreshed.access_token;
    try {
      await prisma.marketplaceConnection.update({
        where: {
          id: connection.id, accountId: connection.accountId,
          accessTokenEnc: connection.accessTokenEnc,
          refreshTokenEnc: connection.refreshTokenEnc,
        },
        data: {
          accessTokenEnc: encryptStockXToken(refreshed.access_token, config.tokenEncryptionKey),
          refreshTokenEnc: refreshed.refresh_token
            ? encryptStockXToken(refreshed.refresh_token, config.tokenEncryptionKey)
            : connection.refreshTokenEnc,
          accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1000),
        },
      });
    } catch (error) {
      // A reconnect or competing rotation replaced the exact credential pair
      // used for this refresh. Never overwrite it or use this stale identity.
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
        throw new StockXIntegrationError(
          stockxErrorCodes.tokenRefreshFailed,
          "The StockX connection changed during refresh. Retry with the current connection.",
          409,
        );
      }
      throw error;
    }
  }

  return accessToken;
}
