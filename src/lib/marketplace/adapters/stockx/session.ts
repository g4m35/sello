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
    await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptStockXToken(refreshed.access_token, config.tokenEncryptionKey),
        refreshTokenEnc: refreshed.refresh_token
          ? encryptStockXToken(refreshed.refresh_token, config.tokenEncryptionKey)
          : connection.refreshTokenEnc,
        accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1000),
      },
    });
  }

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
