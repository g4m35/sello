export type EbayEnvironment = "sandbox" | "production";
export type EbayMarketplaceId = "EBAY_US";

export type EbayConfig = {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  redirectUriName: string;
  marketplaceId: EbayMarketplaceId;
  tokenEncryptionKey: string;
};

export type EbayReadinessResponse = {
  marketplace: "ebay";
  environment: EbayEnvironment;
  connected: boolean;
  ready: boolean;
  /** The stored eBay token is expired/revoked; the seller must reconnect. */
  reconnectRequired?: boolean;
  missing: string[];
  config: {
    marketplaceId: EbayMarketplaceId;
    hasPaymentPolicy: boolean;
    hasFulfillmentPolicy: boolean;
    hasReturnPolicy: boolean;
    hasInventoryLocation: boolean;
  };
  checkedAt?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type EbayTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
};

export type EbayPaymentPolicy = {
  paymentPolicyId?: string;
  name?: string;
};

export type EbayFulfillmentPolicy = {
  fulfillmentPolicyId?: string;
  name?: string;
};

export type EbayReturnPolicy = {
  returnPolicyId?: string;
  name?: string;
};

export type EbayInventoryLocation = {
  merchantLocationKey?: string;
  merchantLocationStatus?: string;
  name?: string;
};

export type EbayApiClient = {
  listPaymentPolicies(): Promise<EbayPaymentPolicy[]>;
  listFulfillmentPolicies(): Promise<EbayFulfillmentPolicy[]>;
  listReturnPolicies(): Promise<EbayReturnPolicy[]>;
  listInventoryLocations(): Promise<EbayInventoryLocation[]>;
};
