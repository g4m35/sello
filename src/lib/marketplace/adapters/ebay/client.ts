import { getEbayConfig } from "./config";
import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import { decryptEbayToken, encryptEbayToken } from "./token-crypto";
import type {
  EbayApiClient,
  EbayConfig,
  EbayFulfillmentPolicy,
  EbayInventoryLocation,
  EbayPaymentPolicy,
  EbayReturnPolicy,
  EbayTokenResponse,
} from "./types";

const apiBaseUrl = "https://api.sandbox.ebay.com";
const tokenUrl = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

type EbayTokenConnection = {
  id: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
};

export type EbayTokenPrismaLike = {
  marketplaceConnection: {
    update(args: {
      where: { id: string };
      data: {
        accessTokenEnc: string;
        refreshTokenEnc?: string;
        accessTokenExpiresAt: Date;
        refreshTokenExpiresAt?: Date;
        scopes?: string[];
      };
    }): Promise<unknown>;
  };
};

export class EbaySandboxClient implements EbayApiClient {
  constructor(
    private readonly accessToken: string,
    private readonly marketplaceId = getEbayConfig().marketplaceId,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listPaymentPolicies() {
    const payload = await this.get<{ paymentPolicies?: EbayPaymentPolicy[] }>(
      `/sell/account/v1/payment_policy?marketplace_id=${this.marketplaceId}`,
    );
    return payload.paymentPolicies ?? [];
  }

  async listFulfillmentPolicies() {
    const payload = await this.get<{
      fulfillmentPolicies?: EbayFulfillmentPolicy[];
    }>(
      `/sell/account/v1/fulfillment_policy?marketplace_id=${this.marketplaceId}`,
    );
    return payload.fulfillmentPolicies ?? [];
  }

  async listReturnPolicies() {
    const payload = await this.get<{ returnPolicies?: EbayReturnPolicy[] }>(
      `/sell/account/v1/return_policy?marketplace_id=${this.marketplaceId}`,
    );
    return payload.returnPolicies ?? [];
  }

  async listInventoryLocations() {
    const payload = await this.get<{ locations?: EbayInventoryLocation[] }>(
      "/sell/inventory/v1/location",
    );
    return payload.locations ?? [];
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new EbayIntegrationError(
        ebayErrorCodes.apiFailed,
        "eBay sandbox API request failed.",
        502,
        { status: response.status },
      );
    }

    return (await response.json()) as T;
  }
}

export async function getUsableEbayAccessToken(
  prisma: EbayTokenPrismaLike,
  connection: EbayTokenConnection,
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
) {
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptEbayToken(connection.accessTokenEnc, config.tokenEncryptionKey);
  }

  const refreshToken = decryptEbayToken(
    connection.refreshTokenEnc,
    config.tokenEncryptionKey,
  );
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: [
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
      ].join(" "),
    }),
  });

  if (!response.ok) {
    throw new EbayIntegrationError(
      ebayErrorCodes.tokenRefreshFailed,
      "eBay sandbox token refresh failed.",
      502,
      { status: response.status },
    );
  }

  const payload = (await response.json()) as EbayTokenResponse;
  const accessTokenExpiresAt = new Date(Date.now() + payload.expires_in * 1000);
  await prisma.marketplaceConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encryptEbayToken(
        payload.access_token,
        config.tokenEncryptionKey,
      ),
      ...(payload.refresh_token
        ? {
            refreshTokenEnc: encryptEbayToken(
              payload.refresh_token,
              config.tokenEncryptionKey,
            ),
          }
        : {}),
      accessTokenExpiresAt,
      ...(payload.refresh_token_expires_in
        ? {
            refreshTokenExpiresAt: new Date(
              Date.now() + payload.refresh_token_expires_in * 1000,
            ),
          }
        : {}),
      ...(payload.scope ? { scopes: payload.scope.split(/\s+/).filter(Boolean) } : {}),
    },
  });

  return payload.access_token;
}
