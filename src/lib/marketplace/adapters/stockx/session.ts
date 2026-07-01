import type { MarketplaceConnection } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import { decryptStockXToken } from "./token-crypto";
import { STOCKX_ENVIRONMENT, type StockXConfig } from "./types";

type Db = ReturnType<typeof getPrisma>;

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
    },
  });

  if (!connection) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConnected,
      "Connect StockX before using StockX catalog tools.",
      403,
    );
  }

  return {
    connection,
    accessToken: decryptStockXToken(connection.accessTokenEnc, config.tokenEncryptionKey),
  };
}
