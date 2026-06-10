import { getEbayConfig } from "./config";
import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type {
  EbayInventoryItemPayload,
  EbayOfferPayload,
} from "./mapper";
import { decryptEbayToken, encryptEbayToken } from "./token-crypto";
import type {
  EbayApiClient,
  EbayConfig,
  EbayEnvironment,
  EbayFulfillmentPolicy,
  EbayInventoryLocation,
  EbayInventoryLocationPayload,
  EbayPaymentPolicy,
  EbayReturnPolicy,
  EbayTokenResponse,
} from "./types";

const apiBaseUrls: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com",
  production: "https://api.ebay.com",
};
const tokenUrls: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  production: "https://api.ebay.com/identity/v1/oauth2/token",
};

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

// Environment-aware eBay REST client (the name predates production support;
// it serves both sandbox and production based on the environment it is given).
export class EbaySandboxClient implements EbayApiClient {
  constructor(
    private readonly accessToken: string,
    private readonly marketplaceId = getEbayConfig().marketplaceId,
    private readonly fetchImpl: typeof fetch = fetch,
    // Sandbox by default: production must always be requested explicitly.
    private readonly environment: EbayEnvironment = "sandbox",
  ) {}

  private get apiBaseUrl() {
    return apiBaseUrls[this.environment];
  }

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

  // Seller setup action: creates an Inventory API ship-from location. eBay
  // error bodies are surfaced (4xx → actionable 422, never a generic 502) so
  // the seller sees exactly what eBay rejected about the address.
  async createInventoryLocation(
    merchantLocationKey: string,
    payload: EbayInventoryLocationPayload,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (response.status === 401) {
      throw new EbayIntegrationError(
        ebayErrorCodes.reconnectRequired,
        "eBay rejected the stored connection. Reconnect your eBay account.",
        409,
        { status: response.status },
      );
    }

    if (!response.ok) {
      const detail = await readEbayErrorMessage(response);
      throw new EbayIntegrationError(
        ebayErrorCodes.locationCreateFailed,
        detail
          ? `eBay rejected the inventory location: ${detail}`
          : `eBay rejected the inventory location (HTTP ${response.status}).`,
        response.status >= 500 ? 502 : 422,
        { status: response.status },
      );
    }
  }

  async createOrReplaceInventoryItem(
    sku: string,
    payload: EbayInventoryItemPayload,
  ): Promise<void> {
    await this.send<unknown>(
      "PUT",
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      payload,
    );
  }

  async createOffer(payload: EbayOfferPayload): Promise<{ offerId: string }> {
    const result = await this.send<{ offerId?: string }>(
      "POST",
      "/sell/inventory/v1/offer",
      payload,
    );
    if (!result?.offerId) {
      throw new EbayIntegrationError(
        ebayErrorCodes.publishFailed,
        "eBay sandbox createOffer returned no offerId.",
        502,
      );
    }
    return { offerId: result.offerId };
  }

  async publishOffer(offerId: string): Promise<{ listingId: string }> {
    const result = await this.send<{ listingId?: string }>(
      "POST",
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish/`,
    );
    if (!result?.listingId) {
      throw new EbayIntegrationError(
        ebayErrorCodes.publishFailed,
        "eBay sandbox publishOffer returned no listingId.",
        502,
      );
    }
    return { listingId: result.listingId };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      // eBay no longer accepts the stored token (expired/revoked). This is a
      // reconnect situation for the seller, never a server fault.
      throw new EbayIntegrationError(
        ebayErrorCodes.reconnectRequired,
        "eBay rejected the stored connection. Reconnect your eBay account.",
        409,
        { status: response.status },
      );
    }

    if (!response.ok) {
      throw new EbayIntegrationError(
        ebayErrorCodes.apiFailed,
        `eBay API request failed (HTTP ${response.status}).`,
        502,
        { status: response.status },
      );
    }

    return (await response.json()) as T;
  }

  // Mutating requests used by the publish flow. Failures normalize to a typed
  // EBAY_PUBLISH_FAILED error carrying only the HTTP status, never the bearer
  // token or request body, so error payloads can be surfaced safely.
  private async send<T>(
    method: "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      throw new EbayIntegrationError(
        ebayErrorCodes.publishFailed,
        "eBay sandbox publish request failed.",
        502,
        { status: response.status },
      );
    }

    const text = await response.text();
    if (!text) {
      return null;
    }
    return JSON.parse(text) as T;
  }
}

// Best-effort extraction of eBay's human-readable error messages. Never
// includes tokens (eBay error bodies don't carry them) and never throws.
async function readEbayErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      errors?: { message?: string; longMessage?: string }[];
    };
    const messages = (body.errors ?? [])
      .map((e) => e.longMessage || e.message)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    return messages.length > 0 ? messages.join(" ") : null;
  } catch {
    return null;
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
  const response = await fetchImpl(tokenUrls[config.environment], {
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

  if (response.status === 400 || response.status === 401) {
    // invalid_grant / unauthorized: the refresh token is expired or revoked.
    // The seller must reauthorize; retrying server-side can never succeed.
    throw new EbayIntegrationError(
      ebayErrorCodes.reconnectRequired,
      "Your eBay connection has expired or was revoked. Reconnect your eBay account.",
      409,
      { status: response.status },
    );
  }

  if (!response.ok) {
    throw new EbayIntegrationError(
      ebayErrorCodes.tokenRefreshFailed,
      `eBay token refresh failed (HTTP ${response.status}).`,
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
