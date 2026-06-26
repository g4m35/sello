import "server-only";

import { getPrisma } from "@/lib/prisma";

import { createEtsyClient, type EtsyClient } from "./client";
import { getEtsyConfig } from "./config";
import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import { refreshAccessToken } from "./oauth";
import { decryptEtsyToken, encryptEtsyToken } from "./token-crypto";
import { ETSY_ENVIRONMENT } from "./types";

const REFRESH_BUFFER_MS = 60_000;

export type EtsyAuthorizedSession = {
  client: EtsyClient;
  shopId: number;
  connectionId: string;
};

// Resolves a ready-to-use, authenticated Etsy session for a seller: loads the
// stored connection, transparently refreshes an expiring access token (persisting
// the rotation), builds the API client, and resolves the seller's shop id. Throws
// a typed notConnected/reconnectRequired/shopMissing when any of that is missing.
export async function getEtsyAuthorizedSession(args: {
  userId: string;
  accountId?: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: number;
}): Promise<EtsyAuthorizedSession> {
  const env = args.env ?? process.env;
  const config = getEtsyConfig(env);
  const prisma = getPrisma();
  const now = args.now ?? Date.now();

  const connection = await prisma.marketplaceConnection.findUnique({
    where: args.accountId
      ? {
          accountId_marketplace_environment: {
            accountId: args.accountId,
            marketplace: "etsy",
            environment: ETSY_ENVIRONMENT,
          },
        }
      : {
          userId_marketplace_environment: {
            userId: args.userId,
            marketplace: "etsy",
            environment: ETSY_ENVIRONMENT,
          },
        },
  });

  if (!connection) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notConnected,
      "Connect your Etsy shop before using live Etsy actions.",
      409,
    );
  }

  let accessToken = decryptEtsyToken(connection.accessTokenEnc, config.tokenEncryptionKey);

  if (connection.accessTokenExpiresAt.getTime() - REFRESH_BUFFER_MS <= now) {
    const refreshToken = decryptEtsyToken(connection.refreshTokenEnc, config.tokenEncryptionKey);
    const refreshed = await refreshAccessToken(config, refreshToken, args.fetchImpl);
    accessToken = refreshed.access_token;
    await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptEtsyToken(refreshed.access_token, config.tokenEncryptionKey),
        refreshTokenEnc: refreshed.refresh_token
          ? encryptEtsyToken(refreshed.refresh_token, config.tokenEncryptionKey)
          : connection.refreshTokenEnc,
        accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1000),
      },
    });
  }

  const client = createEtsyClient({ config, accessToken, fetchImpl: args.fetchImpl });
  const me = await client.getMe();
  const shopId = me.shop_id ?? null;
  if (!shopId) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.shopMissing,
      "No Etsy shop is associated with this connection.",
      409,
    );
  }

  return { client, shopId, connectionId: connection.id };
}
